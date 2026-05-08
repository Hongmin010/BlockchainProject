/**
 * ============================================================
 *  이벤트 인덱서 (Event Indexer) — v2.0
 * ============================================================
 *
 *  목적
 *  ----
 *  스마트 컨트랙트에서 발생하는 3종 이벤트를 폴링하여
 *  PostgreSQL DB(`db/schema.sql`)에 영속화한다.
 *  체인 직접 쿼리는 느리고 비싸므로, 우리 서비스는
 *  "인덱싱된 DB" 를 통해 빠른 통계/검증/대시보드 응답을 제공한다.
 *
 *  V1 → V2 변경 요약
 *  -----------------
 *   - 처리 이벤트 6개 → 3개 (요청+VRF송신 통합, 결과+VRF응답 통합,
 *     UserItemStateUpdated 제거).
 *   - vrf_requests 테이블 흡수 → attempts 한 행에서 라이프사이클 추적.
 *   - user_items 갱신은 컨트랙트 이벤트 없이 백엔드가 자동 UPSERT.
 *     ★ EnhancementCompleted 핸들러에서 attempts UPDATE 와
 *       user_items UPSERT 를 한 DB 트랜잭션으로 묶는다.
 *
 *  처리 대상 이벤트 (docs/events.md 의 v2.0 명세)
 *  ----------------------------------------------
 *   (1) EnhancementRequested     → attempts INSERT
 *   (2) EnhancementCompleted     → attempts UPDATE  +  user_items UPSERT (★ 한 트랜잭션)
 *   (3) ProbabilityTableUpdated  → probability_history INSERT (★ 차별화)
 *
 *  ────────────────────────────────────────────────────────────
 *  핵심 설계 결정 (발표 시 설명용 요약)
 *  ────────────────────────────────────────────────────────────
 *
 *  [A] 폴링 vs WebSocket — 폴링 채택
 *      WebSocket은 연결 끊김 시 누락 위험이 있음. 폴링은 cursor
 *      기반 재처리가 자연스러움. 추후 두 방식을 합칠 수 있음.
 *
 *  [B] BATCH_SIZE = 1000 블록
 *      대부분 RPC 노드의 getLogs 응답 한도(예: Alchemy 기본 1만
 *      블록 / Infura 기본 1만)보다 충분히 작아 안전.
 *      너무 작으면 백필 시 RPC 호출 횟수 폭증, 너무 크면 한 번에
 *      메모리 부담 + 한도 초과 가능. 1000은 경험적으로 안전한 값.
 *
 *  [C] CONFIRMATION_BLOCKS = 5
 *      이더리움 메인넷에서 5~12 블록이 reorg 안정 구간으로 통용됨.
 *      테스트넷이라면 더 짧아도 무방하지만, 우리는 보수적으로 5.
 *      → "latestBlock - 5" 까지만 "확정"으로 간주하여 인덱싱.
 *
 *  [D] 멱등성(Idempotency)
 *      모든 INSERT 는 (tx_hash, log_index) 자연 키 UNIQUE 제약을
 *      활용한 ON CONFLICT DO NOTHING 으로 작성한다.
 *      이벤트가 두 번 도착해도 DB 상태는 동일.
 *
 *  [E] 도착 순서 비결정성 + DB 트랜잭션
 *      같은 attemptId 에 대해 EnhancementRequested 보다
 *      EnhancementCompleted 가 먼저 도착할 수 있다(reorg/재처리 등).
 *      → UPSERT 패턴으로 순서 무관하게 처리.
 *      → ★ EnhancementCompleted 핸들러는 반드시 db.transaction 으로
 *        attempts UPDATE 와 user_items UPSERT 를 원자적으로 수행.
 *        한쪽만 갱신되어 무결성이 깨지는 상황을 차단한다.
 *
 *  TODO (발표 후 본구현)
 *  ---------------------
 *   - 실제 ABI 로드 (artifacts/Enhancement.json 등)
 *   - 각 handle* 함수의 DB 쿼리 작성
 *   - 에러 발생 시 알림(Slack webhook 등)
 *   - WebSocket 실시간 구독 모드 추가
 * ============================================================
 */

require('dotenv').config();
const { ethers } = require('ethers');

// ------------------------------------------------------------
//  환경변수 및 상수
// ------------------------------------------------------------
const RPC_URL = process.env.RPC_URL;
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;
const DATABASE_URL = process.env.DATABASE_URL;

// 폴링 주기 (ms) — 평균 블록타임(12초)을 고려한 기본값
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 12_000);

// 한 번에 조회할 블록 범위 (위 [B] 참고)
const BATCH_SIZE = Number(process.env.BATCH_SIZE || 1_000);

// reorg 안전 버퍼 (위 [C] 참고)
const CONFIRMATION_BLOCKS = Number(process.env.CONFIRMATION_BLOCKS || 5);


// ------------------------------------------------------------
//  대상 이벤트 시그니처 (docs/events.md v2.0 와 일치해야 함)
// ------------------------------------------------------------
//  ethers v6 의 Interface 가 keccak256 으로 자동 토픽 계산.
//  컨트랙트 ABI 파일이 준비되면 이 배열은 ABI 로 대체 가능.
//
//  ★ V2: 6개 → 3개로 축소
//   - EnhancementAttempted + RandomnessRequested → EnhancementRequested
//   - EnhancementResult + RandomnessFulfilled    → EnhancementCompleted
//   - UserItemStateUpdated                        → 제거 (백엔드 자동 갱신)
// ------------------------------------------------------------
const EVENT_SIGNATURES = [
  'event EnhancementRequested(uint256 indexed attemptId, address indexed user, uint256 indexed itemId, uint8 beforeLevel, uint8 enhancementType, uint32 successRate, bytes32 randomnessRequestId)',
  'event EnhancementCompleted(uint256 indexed attemptId, address indexed user, uint256 indexed itemId, bytes32 randomnessRequestId, uint256 randomValue, uint8 beforeLevel, uint8 afterLevel, bool success, uint32 successRate)',
  'event ProbabilityTableUpdated(uint8 indexed level, uint32 oldSuccessRate, uint32 newSuccessRate, uint256 timestamp)',
];

// 이벤트명 → 핸들러 매핑 (아래에서 정의)
const EVENT_HANDLERS = {
  EnhancementRequested: handleEnhancementRequested,
  EnhancementCompleted: handleEnhancementCompleted,
  ProbabilityTableUpdated: handleProbabilityTableUpdated,
};


// ============================================================
//  메인 루프
// ============================================================
async function main() {
  console.log('[indexer] 부팅 (v2.0)');
  console.log('[indexer]   RPC          :', RPC_URL);
  console.log('[indexer]   CONTRACT     :', CONTRACT_ADDRESS);
  console.log('[indexer]   BATCH_SIZE   :', BATCH_SIZE);
  console.log('[indexer]   CONFIRM_BLKS :', CONFIRMATION_BLOCKS);

  // TODO: pg.Pool 로 DATABASE_URL 연결, 트랜잭션 헬퍼(db.transaction) 준비
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const iface = new ethers.Interface(EVENT_SIGNATURES);

  // 무한 폴링 루프 ([A] 참고)
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await tick(provider, iface);
    } catch (err) {
      console.error('[indexer] tick 오류:', err);
      // 한 사이클 실패해도 다음 사이클로 계속
    }
    await sleep(POLL_INTERVAL_MS);
  }
}


/**
 * 한 사이클: cursor 부터 (latest - CONFIRMATION_BLOCKS) 까지
 * BATCH_SIZE 단위로 끊어 처리. ([B], [C] 참고)
 */
async function tick(provider, iface) {
  const latest = await provider.getBlockNumber();
  const safeHead = latest - CONFIRMATION_BLOCKS;

  // TODO: indexer_cursor 에서 last_block 조회
  let from = await loadCursor() + 1;

  if (from > safeHead) {
    // 새 확정 블록 없음 — 다음 폴링까지 대기
    return;
  }

  while (from <= safeHead) {
    const to = Math.min(from + BATCH_SIZE - 1, safeHead);
    console.log(`[indexer] 처리 범위: ${from} → ${to} (safeHead=${safeHead})`);

    const logs = await provider.getLogs({
      address: CONTRACT_ADDRESS,
      fromBlock: from,
      toBlock: to,
    });

    for (const log of logs) {
      await dispatch(iface, log);
    }

    // TODO: indexer_cursor 의 last_block 을 to 로 갱신 (트랜잭션 안에서)
    await saveCursor(to);

    from = to + 1;
  }
}


/**
 * 단일 로그를 디코딩하여 적절한 핸들러로 분기.
 * 알 수 없는 이벤트는 무시(향후 컨트랙트가 새 이벤트를 추가해도
 * 인덱서가 죽지 않도록).
 */
async function dispatch(iface, log) {
  let parsed;
  try {
    parsed = iface.parseLog({ topics: log.topics, data: log.data });
  } catch {
    // ABI 에 없는 이벤트 → 무시
    return;
  }
  if (!parsed) return;

  const handler = EVENT_HANDLERS[parsed.name];
  if (!handler) {
    console.warn('[indexer] 핸들러 없음:', parsed.name);
    return;
  }

  await handler(parsed.args, {
    txHash: log.transactionHash,
    logIndex: log.index,
    blockNumber: log.blockNumber,
    // TODO: provider.getBlock(blockNumber) 로 timestamp 조회 (캐시 권장)
  });
}


// ============================================================
//  이벤트별 핸들러 (placeholder — DB 구현은 본구현 단계)
// ============================================================
//  각 함수는 args (이벤트 인자) + meta (블록/트랜잭션 메타) 를 받고
//  schema.sql 의 해당 테이블에 멱등하게 INSERT/UPDATE 를 수행한다.
// ============================================================

/**
 * (1) EnhancementRequested → attempts INSERT (status='pending')
 *
 *  args: { attemptId, user, itemId, beforeLevel, enhancementType,
 *          successRate, randomnessRequestId }
 *
 *  DB:
 *    INSERT INTO attempts
 *      (attempt_id, user_address, item_id, enhancement_type, before_level,
 *       claimed_success_rate, randomness_request_id, status,
 *       requested_tx_hash, requested_log_index, requested_block, requested_at)
 *    VALUES (...)
 *    ON CONFLICT (requested_tx_hash, requested_log_index) DO NOTHING;
 *
 *  멱등성: 위 ON CONFLICT 절이 (tx_hash, log_index) UNIQUE 제약을 활용. ([D])
 *
 *  도착 순서: Completed 가 먼저 도착해 행이 이미 존재할 가능성도 있다 ([E]).
 *            그 경우엔 attempt_id PK 충돌이 날 수 있으므로,
 *            본구현 시 attempt_id 기준 ON CONFLICT DO UPDATE 로 보강해
 *            requested_* 메타만 채우는 패턴이 필요할 수 있다.
 */
async function handleEnhancementRequested(args, meta) {
  // TODO (본구현):
  //   - user_address 는 lowercase 정규화
  //   - randomnessRequestId 는 hex string 그대로 저장
  //   - 위 INSERT 쿼리 실행
  console.log(
    '[indexer] EnhancementRequested',
    'attempt=', args.attemptId?.toString(),
    'user=', args.user,
    'item=', args.itemId?.toString(),
    'rate=', args.successRate?.toString(),
    'vrfReqId=', args.randomnessRequestId
  );
}

/**
 * (2) EnhancementCompleted → attempts UPDATE + user_items UPSERT
 *     ★ 반드시 한 DB 트랜잭션으로 ([E])
 *
 *  args: { attemptId, user, itemId, randomnessRequestId, randomValue,
 *          beforeLevel, afterLevel, success, successRate }
 *
 *  ★ 핵심 설계 결정 (docs/design_decisions.md 결정 1):
 *    user_items 는 컨트랙트 이벤트 없이 이 핸들러가 자동 UPSERT 한다.
 *    attempts UPDATE 와 user_items UPSERT 를 한 트랜잭션으로 묶어
 *    "결과는 기록됐는데 사용자 상태는 안 바뀐" 같은 무결성 깨짐을 차단.
 *
 *  의사 코드:
 *    await db.transaction(async (tx) => {
 *      // 1) attempts UPDATE
 *      await tx.query(`
 *        UPDATE attempts
 *           SET after_level   = $1,
 *               success       = $2,
 *               random_value  = $3,
 *               status        = 'completed',
 *               completed_tx_hash   = $4,
 *               completed_log_index = $5,
 *               completed_block     = $6,
 *               completed_at        = $7,
 *               updated_at          = NOW()
 *         WHERE attempt_id = $8
 *      `, [...]);
 *
 *      // 2) user_items UPSERT (이벤트 없이 자동 — V2 설계 핵심) ★
 *      await tx.query(`
 *        INSERT INTO user_items
 *          (user_address, item_id, level, total_attempts,
 *           last_tx_hash, last_log_index, last_block, last_updated_at)
 *        VALUES ($1, $2, $3, 1, $4, $5, $6, $7)
 *        ON CONFLICT (user_address, item_id) DO UPDATE
 *          SET level           = EXCLUDED.level,
 *              total_attempts  = user_items.total_attempts + 1,
 *              last_tx_hash    = EXCLUDED.last_tx_hash,
 *              last_log_index  = EXCLUDED.last_log_index,
 *              last_block      = EXCLUDED.last_block,
 *              last_updated_at = EXCLUDED.last_updated_at,
 *              updated_at      = NOW()
 *          -- reorg-safe: 이미 더 큰 last_block 이 들어가 있으면 덮어쓰지 않음
 *          WHERE user_items.last_block <= EXCLUDED.last_block;
 *      `, [...]);
 *    });
 *
 *  멱등성 보강:
 *   - attempts UPDATE 는 status='pending' 인 경우만 변경하도록 가드 추가 가능.
 *   - user_items 의 last_block 비교로 옛 이벤트 재처리 방지.
 */
async function handleEnhancementCompleted(args, meta) {
  // TODO (본구현):
  //   await db.transaction(async (tx) => {
  //     // 1) attempts UPDATE (위 의사 코드 참고)
  //     // 2) user_items UPSERT — 이벤트 없이 백엔드가 자동 갱신 ★
  //   });
  console.log(
    '[indexer] EnhancementCompleted',
    'attempt=', args.attemptId?.toString(),
    'user=', args.user,
    'item=', args.itemId?.toString(),
    'beforeL=', args.beforeLevel,
    'afterL=', args.afterLevel,
    'success=', args.success,
    'random=', args.randomValue?.toString()
  );
}

/**
 * (3) ProbabilityTableUpdated → probability_history INSERT (★ 차별화)
 *
 *  args: { level, oldSuccessRate, newSuccessRate, timestamp }
 *
 *  DB:
 *    INSERT INTO probability_history
 *      (level, old_success_rate, new_success_rate, on_chain_timestamp,
 *       tx_hash, log_index, block_number)
 *    VALUES (...)
 *    ON CONFLICT (tx_hash, log_index) DO NOTHING;
 *
 *  V2에서도 변경 없음 — 시도 이벤트와 라이프사이클이 다른 운영자 행위.
 */
async function handleProbabilityTableUpdated(args, meta) {
  // TODO (본구현):
  //   - timestamp(uint256, 초) 를 to_timestamp() 로 TIMESTAMPTZ 변환
  //   - 위 INSERT 쿼리 실행
  console.log(
    '[indexer] ProbabilityTableUpdated',
    'L', args.level,
    args.oldSuccessRate?.toString(), '→', args.newSuccessRate?.toString()
  );
}


// ============================================================
//  cursor 헬퍼 (placeholder — DB 연동 시 구현)
// ============================================================
async function loadCursor() {
  // TODO: SELECT last_block FROM indexer_cursor WHERE id='main'
  return 0;
}
async function saveCursor(blockNumber) {
  // TODO: UPDATE indexer_cursor SET last_block=$, updated_at=NOW() WHERE id='main'
}


// ------------------------------------------------------------
//  유틸
// ------------------------------------------------------------
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}


// ------------------------------------------------------------
//  진입점
// ------------------------------------------------------------
if (require.main === module) {
  main().catch((err) => {
    console.error('[indexer] 치명적 오류:', err);
    process.exit(1);
  });
}

module.exports = {
  main,
  EVENT_SIGNATURES,
  // 테스트 편의를 위해 핸들러도 export
  handlers: EVENT_HANDLERS,
};

/**
 * ============================================================
 *  이벤트 인덱서 (Event Indexer) — v1.0
 * ============================================================
 *
 *  목적
 *  ----
 *  스마트 컨트랙트에서 발생하는 6종 이벤트를 폴링하여
 *  PostgreSQL DB(`db/schema.sql`)에 영속화한다.
 *  체인 직접 쿼리는 느리고 비싸므로, 우리 서비스는
 *  "인덱싱된 DB" 를 통해 빠른 통계/검증/대시보드 응답을 제공한다.
 *
 *  처리 대상 이벤트 (docs/events.md 의 v1.0 명세)
 *  ----------------------------------------------
 *   (1) EnhancementAttempted     → attempts INSERT
 *   (2) EnhancementResult        → attempts UPDATE
 *   (3) RandomnessRequested      → vrf_requests INSERT
 *   (4) RandomnessFulfilled      → vrf_requests UPDATE
 *   (5) UserItemStateUpdated     → user_items UPSERT
 *   (6) ProbabilityTableUpdated  → probability_history INSERT (★ 차별화)
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
 *  [E] 도착 순서 비결정성
 *      같은 attemptId 에 대해
 *      EnhancementAttempted → RandomnessRequested →
 *      RandomnessFulfilled → EnhancementResult
 *      순서가 보장되지 않을 수 있음(다른 블록에 있을 수 있고,
 *      한 batch 안에서도 처리 순서가 흔들릴 수 있음).
 *      → 각 핸들러는 자기 테이블만 건드리고, JOIN 으로 조립한다.
 *
 *  TODO (발표 후 본구현)
 *  ---------------------
 *   - 실제 ABI 로드 (artifacts/Enhancement.json 등)
 *   - 각 handle* 함수의 DB INSERT/UPDATE 작성
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
//  대상 이벤트 시그니처 (docs/events.md v1.0 와 일치해야 함)
// ------------------------------------------------------------
//  ethers v6 의 Interface 가 keccak256 으로 자동 토픽 계산.
//  컨트랙트 ABI 파일이 준비되면 이 배열은 ABI 로 대체 가능.
// ------------------------------------------------------------
const EVENT_SIGNATURES = [
  'event EnhancementAttempted(uint256 indexed attemptId, address indexed user, uint256 indexed itemId, uint8 beforeLevel, uint8 enhancementType, uint32 successRate)',
  'event EnhancementResult(uint256 indexed attemptId, address indexed user, uint256 indexed itemId, uint8 beforeLevel, uint8 afterLevel, bool success, uint32 successRate, uint256 randomValue)',
  'event RandomnessRequested(uint256 indexed attemptId, address indexed user, bytes32 randomnessRequestId)',
  'event RandomnessFulfilled(uint256 indexed attemptId, bytes32 indexed randomnessRequestId, uint256 randomValue)',
  'event UserItemStateUpdated(address indexed user, uint256 indexed itemId, uint8 level, uint256 totalAttempts)',
  'event ProbabilityTableUpdated(uint8 indexed level, uint32 oldSuccessRate, uint32 newSuccessRate, uint256 timestamp)',
];

// 이벤트명 → 핸들러 매핑 (아래에서 정의)
const EVENT_HANDLERS = {
  EnhancementAttempted: handleEnhancementAttempted,
  EnhancementResult: handleEnhancementResult,
  RandomnessRequested: handleRandomnessRequested,
  RandomnessFulfilled: handleRandomnessFulfilled,
  UserItemStateUpdated: handleUserItemStateUpdated,
  ProbabilityTableUpdated: handleProbabilityTableUpdated,
};


// ============================================================
//  메인 루프
// ============================================================
async function main() {
  console.log('[indexer] 부팅');
  console.log('[indexer]   RPC          :', RPC_URL);
  console.log('[indexer]   CONTRACT     :', CONTRACT_ADDRESS);
  console.log('[indexer]   BATCH_SIZE   :', BATCH_SIZE);
  console.log('[indexer]   CONFIRM_BLKS :', CONFIRMATION_BLOCKS);

  // TODO: pg.Pool 로 DATABASE_URL 연결
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const iface = new ethers.Interface(EVENT_SIGNATURES);

  // 무한 폴링 루프
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
 * BATCH_SIZE 단위로 끊어 처리.
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
//  이벤트별 핸들러 (placeholder)
// ============================================================
//  각 함수는 args (이벤트 인자) + meta (블록/트랜잭션 메타) 를 받고
//  schema.sql 의 해당 테이블에 멱등하게 INSERT/UPDATE 를 수행한다.
// ============================================================

/** (1) EnhancementAttempted → attempts INSERT (status='pending') */
async function handleEnhancementAttempted(args, meta) {
  // args: { attemptId, user, itemId, beforeLevel, enhancementType, successRate }
  // TODO: INSERT INTO attempts (...) VALUES (...) ON CONFLICT (attempted_tx_hash, attempted_log_index) DO NOTHING
  console.log('[indexer] EnhancementAttempted', args.attemptId?.toString());
}

/** (2) EnhancementResult → attempts UPDATE (status='fulfilled') */
async function handleEnhancementResult(args, meta) {
  // args: { attemptId, user, itemId, beforeLevel, afterLevel, success, successRate, randomValue }
  // TODO: UPDATE attempts SET after_level=$, success=$, random_value=$, status='fulfilled', fulfilled_*=$
  //         WHERE attempt_id=$
  // 주의: result 가 attempted 보다 먼저 도착할 수 있음 → INSERT ... ON CONFLICT UPDATE 패턴 권장
  console.log('[indexer] EnhancementResult', args.attemptId?.toString(), 'success=', args.success);
}

/** (3) RandomnessRequested → vrf_requests INSERT (status='pending') */
async function handleRandomnessRequested(args, meta) {
  // args: { attemptId, user, randomnessRequestId }
  // TODO: INSERT INTO vrf_requests (randomness_request_id, attempt_id, user_address, ...)
  //         VALUES (...) ON CONFLICT (requested_tx_hash, requested_log_index) DO NOTHING
  console.log('[indexer] RandomnessRequested', args.randomnessRequestId);
}

/** (4) RandomnessFulfilled → vrf_requests UPDATE (status='fulfilled') */
async function handleRandomnessFulfilled(args, meta) {
  // args: { attemptId, randomnessRequestId, randomValue }
  // TODO: UPDATE vrf_requests SET random_value=$, status='fulfilled', fulfilled_*=$
  //         WHERE randomness_request_id=$
  console.log('[indexer] RandomnessFulfilled', args.randomnessRequestId);
}

/** (5) UserItemStateUpdated → user_items UPSERT */
async function handleUserItemStateUpdated(args, meta) {
  // args: { user, itemId, level, totalAttempts }
  // TODO: INSERT INTO user_items (...) VALUES (...) ON CONFLICT (user_address, item_id) DO UPDATE
  //         SET level=EXCLUDED.level, total_attempts=EXCLUDED.total_attempts, ...
  //       단, last_block 이 더 큰 경우에만 UPDATE 하여 reorg-safe 하게 처리
  console.log('[indexer] UserItemStateUpdated', args.user, args.itemId?.toString(), 'L', args.level);
}

/** (6) ProbabilityTableUpdated → probability_history INSERT (★ 차별화) */
async function handleProbabilityTableUpdated(args, meta) {
  // args: { level, oldSuccessRate, newSuccessRate, timestamp }
  // TODO: INSERT INTO probability_history (...) VALUES (...)
  //         ON CONFLICT (tx_hash, log_index) DO NOTHING
  console.log('[indexer] ProbabilityTableUpdated', 'L', args.level,
              args.oldSuccessRate?.toString(), '→', args.newSuccessRate?.toString());
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

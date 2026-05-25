/**
 * ============================================================
 *  이벤트 인덱서 (Event Indexer) — v3 (배포본 일치화)
 * ============================================================
 *
 *  목적
 *  ----
 *  Base Sepolia 의 `EnhancementGameVRF` 컨트랙트
 *  (`0xd9f2e53cad519668d02ecc0dbdd49b42938e9ab2`) 가 emit 하는
 *  3종 이벤트를 폴링하여 PostgreSQL DB(`db/schema.sql`) 에 영속화한다.
 *
 *  V2 → V3 변경 (배포본 일치화)
 *  ----------------------------
 *   - 이벤트 시그니처: V2 명세(bytes32 randomnessRequestId, EnhancementCompleted,
 *     bool success, uint32 successRate, ...) 와 배포본의 차이를 흡수.
 *     자세한 매핑은 docs/events.md 참고.
 *   - 결과 이벤트 핸들러명 EnhancementCompleted → EnhancementResult.
 *   - vrf_request_id 컬럼 자료형 NUMERIC(78,0) 로 전환.
 *   - probability_history 에 updater, enhancement_type 컬럼 사용.
 *   - on_chain_timestamp 은 이벤트에 없음 — provider.getBlock 으로 보강.
 *   - V2 사고(이벤트 vs 테이블 책임 분리, user_items 자동 갱신, VRF 라이프사이클 통합)는
 *     그대로 유효.
 *
 *  처리 대상 이벤트 (docs/events.md v3 명세)
 *  ----------------------------------------
 *   (1) EnhancementRequested     → attempts UPSERT (status='pending')
 *   (2) EnhancementResult        → attempts UPSERT (status='completed') + user_items UPSERT
 *                                  (★ 한 DB 트랜잭션)
 *   (3) ProbabilityTableUpdated  → probability_history INSERT (★ 차별화)
 *
 *  ────────────────────────────────────────────────────────────
 *  핵심 설계 결정 (발표 시 설명용 요약)
 *  ────────────────────────────────────────────────────────────
 *
 *  [A] 폴링 vs WebSocket — 폴링 채택
 *      WebSocket 은 연결 끊김 시 누락 위험. 폴링은 cursor 기반 재처리가 자연스러움.
 *
 *  [B] BATCH_SIZE = 1000 블록
 *      대부분 RPC 노드의 getLogs 응답 한도(예: Alchemy 기본 1만 블록) 보다 충분히
 *      작아 안전. 1000 은 경험적 안전값.
 *
 *  [C] CONFIRMATION_BLOCKS = 5
 *      "latestBlock - 5" 까지만 확정으로 간주하여 reorg 안전 버퍼.
 *
 *  [D] 멱등성(Idempotency)
 *      - attempts: PK(attempt_id) + ON CONFLICT DO UPDATE WHERE status='pending' 가드.
 *        같은 EnhancementResult 두 번 들어와도 두 번째는 WHERE 가 막아 SKIP.
 *      - user_items: 같은 트랜잭션에서, attempts UPSERT 가 실제로 INSERT/UPDATE 됐을
 *        때만 +1 (RETURNING rowCount 으로 판단).
 *      - probability_history: (tx_hash, log_index) UNIQUE + ON CONFLICT DO NOTHING.
 *
 *  [E] 도착 순서 비결정성 + DB 트랜잭션
 *      EnhancementResult 가 EnhancementRequested 보다 먼저 도착 가능.
 *      attempts.attempt_id 기반 UPSERT 로 순서 무관 처리.
 *      EnhancementResult 핸들러는 반드시 db.withTransaction 으로
 *      attempts UPSERT 와 user_items UPSERT 를 원자적으로 수행.
 *
 *  [F] block.timestamp 보강
 *      ProbabilityTableUpdated 에 on-chain timestamp 가 없으므로
 *      provider.getBlock(blockNumber).timestamp 로 채운다.
 *      한 tick 안에서 Map 캐시하여 같은 블록의 다중 로그가 한 번만 RPC 호출.
 *
 *  TODO (발표 후 본구현 확장)
 *  --------------------------
 *   - 에러 발생 시 알림(Slack webhook 등)
 *   - WebSocket 실시간 구독 모드 (폴링과 병행)
 *   - 컨트랙트 ABI 파일을 artifacts 에서 직접 로드 (현재는 시그니처 문자열 사용)
 * ============================================================
 */

'use strict';

require('dotenv').config();
const { ethers } = require('ethers');
const db = require('../db/pool');

// ------------------------------------------------------------
//  환경변수 및 상수
// ------------------------------------------------------------
const RPC_URL = process.env.RPC_URL;
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 12_000);
const BATCH_SIZE = Number(process.env.BATCH_SIZE || 1_000);
const CONFIRMATION_BLOCKS = Number(process.env.CONFIRMATION_BLOCKS || 5);
const CURSOR_ID = 'main';


// ------------------------------------------------------------
//  대상 이벤트 시그니처 (docs/events.md v3 와 일치해야 함)
// ------------------------------------------------------------
const EVENT_SIGNATURES = [
  'event EnhancementRequested(uint256 indexed attemptId, address indexed user, uint256 indexed itemId, uint256 vrfRequestId)',
  'event EnhancementResult(uint256 indexed attemptId, address indexed user, uint256 indexed itemId, uint256 vrfRequestId, uint8 beforeLevel, uint8 afterLevel, uint8 resultType, uint16 successRateBps, uint256 randomValue)',
  'event ProbabilityTableUpdated(address indexed updater, uint8 indexed level, uint8 indexed enhancementType, uint16 oldSuccessRateBps, uint16 newSuccessRateBps)',
];

const EVENT_HANDLERS = {
  EnhancementRequested: handleEnhancementRequested,
  EnhancementResult: handleEnhancementResult,
  ProbabilityTableUpdated: handleProbabilityTableUpdated,
};


// ============================================================
//  메인 루프
// ============================================================
async function main() {
  console.log('[indexer] 부팅 (v3 — 배포본 일치화)');
  console.log('[indexer]   RPC          :', RPC_URL);
  console.log('[indexer]   CONTRACT     :', CONTRACT_ADDRESS);
  console.log('[indexer]   BATCH_SIZE   :', BATCH_SIZE);
  console.log('[indexer]   CONFIRM_BLKS :', CONFIRMATION_BLOCKS);

  if (!RPC_URL) throw new Error('RPC_URL not set — check backend/.env');
  if (!CONTRACT_ADDRESS) throw new Error('CONTRACT_ADDRESS not set — check backend/.env');

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const iface = new ethers.Interface(EVENT_SIGNATURES);

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await tick(provider, iface);
    } catch (err) {
      console.error('[indexer] tick 오류:', err);
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

  let from = (await loadCursor()) + 1;
  if (from > safeHead) return;   // 새 확정 블록 없음

  // block.timestamp 캐시 (한 tick 내에서만 유효)
  const blockTsCache = new Map();

  while (from <= safeHead) {
    const to = Math.min(from + BATCH_SIZE - 1, safeHead);
    console.log(`[indexer] 처리 범위: ${from} → ${to} (safeHead=${safeHead})`);

    const logs = await provider.getLogs({
      address: CONTRACT_ADDRESS,
      fromBlock: from,
      toBlock: to,
    });

    for (const log of logs) {
      await dispatch(iface, log, provider, blockTsCache);
    }

    await saveCursor(to);
    from = to + 1;
  }
}


/**
 * 단일 로그 디코딩 + 핸들러 분기. ABI 에 없는 이벤트는 무시.
 */
async function dispatch(iface, log, provider, blockTsCache) {
  let parsed;
  try {
    parsed = iface.parseLog({ topics: log.topics, data: log.data });
  } catch {
    return;   // 알 수 없는 이벤트는 안전하게 무시
  }
  if (!parsed) return;

  const handler = EVENT_HANDLERS[parsed.name];
  if (!handler) {
    console.warn('[indexer] 핸들러 없음:', parsed.name);
    return;
  }

  const blockTimestamp = await getBlockTimestamp(provider, log.blockNumber, blockTsCache);

  await handler(parsed.args, {
    txHash: log.transactionHash,
    logIndex: log.index,
    blockNumber: log.blockNumber,
    blockTimestamp,
  });
}


async function getBlockTimestamp(provider, blockNumber, cache) {
  if (cache.has(blockNumber)) return cache.get(blockNumber);
  const block = await provider.getBlock(blockNumber);
  const ts = new Date(Number(block.timestamp) * 1000);
  cache.set(blockNumber, ts);
  return ts;
}


// ============================================================
//  이벤트별 핸들러
// ============================================================

/**
 * (1) EnhancementRequested → attempts UPSERT (status='pending')
 *
 *  args: { attemptId, user, itemId, vrfRequestId }
 *
 *  도착 순서가 EnhancementResult 보다 늦을 수 있어, 충돌 시엔 requested_* 메타만
 *  COALESCE 로 채우는 패턴.
 */
async function handleEnhancementRequested(args, meta) {
  await db.query(`
    INSERT INTO attempts
      (attempt_id, user_address, item_id, vrf_request_id, status,
       requested_tx_hash, requested_log_index, requested_block, requested_at)
    VALUES ($1, $2, $3, $4, 'pending', $5, $6, $7, $8)
    ON CONFLICT (attempt_id) DO UPDATE
      SET vrf_request_id      = COALESCE(attempts.vrf_request_id, EXCLUDED.vrf_request_id),
          requested_tx_hash   = COALESCE(attempts.requested_tx_hash, EXCLUDED.requested_tx_hash),
          requested_log_index = COALESCE(attempts.requested_log_index, EXCLUDED.requested_log_index),
          requested_block     = COALESCE(attempts.requested_block, EXCLUDED.requested_block),
          requested_at        = COALESCE(attempts.requested_at, EXCLUDED.requested_at),
          updated_at          = NOW()
  `, [
    args.attemptId.toString(),
    args.user.toLowerCase(),
    args.itemId.toString(),
    args.vrfRequestId.toString(),
    meta.txHash,
    meta.logIndex,
    meta.blockNumber,
    meta.blockTimestamp,
  ]);
}


/**
 * (2) EnhancementResult → attempts UPSERT + user_items UPSERT (★ 한 트랜잭션)
 *
 *  args: { attemptId, user, itemId, vrfRequestId, beforeLevel, afterLevel,
 *          resultType, successRateBps, randomValue }
 *
 *  멱등성 ([D]):
 *   - attempts UPSERT 시 WHERE status='pending' 가드 → 이미 'completed' 면 SKIP.
 *   - user_items UPSERT 는 attempts 가 실제로 INSERT/UPDATE 된 경우(rowCount > 0)에만.
 */
async function handleEnhancementResult(args, meta) {
  await db.withTransaction(async (tx) => {
    const attemptId = args.attemptId.toString();
    const user = args.user.toLowerCase();
    const itemId = args.itemId.toString();
    const afterLevel = Number(args.afterLevel);
    const success = Number(args.resultType) === 1;

    // 1) attempts UPSERT
    const upsert = await tx.query(`
      INSERT INTO attempts
        (attempt_id, user_address, item_id, vrf_request_id,
         before_level, after_level, claimed_success_rate, success, random_value,
         status,
         completed_tx_hash, completed_log_index, completed_block, completed_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'completed', $10, $11, $12, $13)
      ON CONFLICT (attempt_id) DO UPDATE
        SET before_level         = EXCLUDED.before_level,
            after_level          = EXCLUDED.after_level,
            claimed_success_rate = EXCLUDED.claimed_success_rate,
            success              = EXCLUDED.success,
            random_value         = EXCLUDED.random_value,
            vrf_request_id       = COALESCE(attempts.vrf_request_id, EXCLUDED.vrf_request_id),
            status               = 'completed',
            completed_tx_hash    = EXCLUDED.completed_tx_hash,
            completed_log_index  = EXCLUDED.completed_log_index,
            completed_block      = EXCLUDED.completed_block,
            completed_at         = EXCLUDED.completed_at,
            updated_at           = NOW()
        WHERE attempts.status = 'pending'
      RETURNING attempt_id
    `, [
      attemptId, user, itemId, args.vrfRequestId.toString(),
      Number(args.beforeLevel), afterLevel,
      Number(args.successRateBps), success, args.randomValue.toString(),
      meta.txHash, meta.logIndex, meta.blockNumber, meta.blockTimestamp,
    ]);

    if (upsert.rowCount === 0) {
      // 이미 처리된 EnhancementResult — user_items 변경 SKIP (중복 +1 방지)
      return;
    }

    // 2) user_items UPSERT  ★ 컨트랙트 이벤트 없이 자동 갱신
    await tx.query(`
      INSERT INTO user_items
        (user_address, item_id, level, total_attempts,
         last_tx_hash, last_log_index, last_block, last_updated_at)
      VALUES ($1, $2, $3, 1, $4, $5, $6, $7)
      ON CONFLICT (user_address, item_id) DO UPDATE
        SET level           = EXCLUDED.level,
            total_attempts  = user_items.total_attempts + 1,
            last_tx_hash    = EXCLUDED.last_tx_hash,
            last_log_index  = EXCLUDED.last_log_index,
            last_block      = EXCLUDED.last_block,
            last_updated_at = EXCLUDED.last_updated_at,
            updated_at      = NOW()
        -- reorg-safe: 이미 더 큰 block 의 갱신이 들어가 있으면 덮어쓰지 않음
        WHERE user_items.last_block <= EXCLUDED.last_block
    `, [
      user, itemId, afterLevel,
      meta.txHash, meta.logIndex, meta.blockNumber, meta.blockTimestamp,
    ]);
  });
}


/**
 * (3) ProbabilityTableUpdated → probability_history INSERT
 *
 *  args: { updater, level, enhancementType, oldSuccessRateBps, newSuccessRateBps }
 *  on_chain_timestamp 은 컨트랙트가 emit 하지 않음 → meta.blockTimestamp 사용.
 */
async function handleProbabilityTableUpdated(args, meta) {
  await db.query(`
    INSERT INTO probability_history
      (updater, level, enhancement_type,
       old_success_rate, new_success_rate,
       on_chain_timestamp, tx_hash, log_index, block_number)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    ON CONFLICT (tx_hash, log_index) DO NOTHING
  `, [
    args.updater.toLowerCase(),
    Number(args.level),
    Number(args.enhancementType),
    Number(args.oldSuccessRateBps),
    Number(args.newSuccessRateBps),
    meta.blockTimestamp,
    meta.txHash, meta.logIndex, meta.blockNumber,
  ]);
}


// ============================================================
//  cursor 헬퍼
// ============================================================
async function loadCursor() {
  const { rows } = await db.query(
    `SELECT last_block FROM indexer_cursor WHERE id = $1`,
    [CURSOR_ID],
  );
  if (rows.length === 0) {
    await db.query(
      `INSERT INTO indexer_cursor (id, last_block) VALUES ($1, 0)
       ON CONFLICT (id) DO NOTHING`,
      [CURSOR_ID],
    );
    return 0;
  }
  return Number(rows[0].last_block);
}

async function saveCursor(blockNumber) {
  // 이미 더 큰 last_block 이 있으면 덮어쓰지 않음 (재처리/병렬 안전)
  await db.query(
    `UPDATE indexer_cursor
        SET last_block = $1, updated_at = NOW()
      WHERE id = $2 AND last_block < $1`,
    [blockNumber, CURSOR_ID],
  );
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
  handlers: EVENT_HANDLERS,
};

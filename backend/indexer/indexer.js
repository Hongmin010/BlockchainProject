/**
 * ============================================================
 *  이벤트 인덱서 (Event Indexer) — v3 (배포본 일치화)
 * ============================================================
 *
 *  목적
 *  ----
 *  Base Sepolia 의 `EnhancementGameVRF` 컨트랙트
 *  (`0x73e8bbe5ea755376ddd30ea1a2df3dae5d289a59`) 가 emit 하는
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
//  컨트랙트 ABI (홍민 배포본 EnhancementGameVRF)
//  - 파일: backend/abi/EnhancementGameVRF.json
//  - `{ abi: [...] }` 또는 `[...]` 두 형식 모두 대응
// ------------------------------------------------------------
const baseAbiJson = require('../abi/EnhancementGameVRF.json');
const BASE_ABI = baseAbiJson.abi || baseAbiJson;

// v4: 고급강화 컨트랙트 ABI (별도 배포본, base 를 참조)
const advAbiJson = require('../abi/AdvancedEnhancementGameVRF.json');
const ADV_ABI = advAbiJson.abi || advAbiJson;

// v5: 업적 NFT 컨트랙트 — 아직 미배포. 합의된 인터페이스 fragment 로 선행 개발,
//     실제 ABI 도착 시 abi/achievements.fragment.json 만 교체하면 된다.
const ACHIEVEMENTS_ABI = require('../abi/achievements.fragment.json');
const { checkOffchainAchievements } = require('../lib/achievementJudge');
const { mintDetected } = require('../lib/achievementMint');

// ------------------------------------------------------------
//  환경변수 및 상수
// ------------------------------------------------------------
const RPC_URL = process.env.RPC_URL;
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;
// v4: 고급강화 컨트랙트 주소 (미설정 시 base 만 구독 — 하위호환)
const ADVANCED_CONTRACT_ADDRESS = process.env.ADVANCED_CONTRACT_ADDRESS;
// v5: 업적 NFT 컨트랙트 주소 (미배포 — 미설정 시 업적 이벤트 구독 자동 제외)
const ACHIEVEMENTS_NFT_ADDRESS = process.env.ACHIEVEMENTS_NFT_ADDRESS;
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 12_000);
const BATCH_SIZE = Number(process.env.BATCH_SIZE || 1_000);
const CONFIRMATION_BLOCKS = Number(process.env.CONFIRMATION_BLOCKS || 5);
const CURSOR_ID = 'main';


// ------------------------------------------------------------
//  대상 이벤트 (docs/events.md v3 와 일치해야 함)
//
//  v3 부터 ABI 파일에서 직접 로드 → ethers.Interface 가 keccak256 토픽 해시를
//  자동 계산. 컨트랙트가 추가 이벤트를 emit해도 인덱서가 죽지 않도록
//  EVENT_HANDLERS 매핑에 없는 이벤트는 dispatch() 에서 안전하게 무시.
//
//  이전: 하드코딩 시그니처 (참고용 — ABI 도입 전 사용)
//  -----------------------------------------------------
//  const EVENT_SIGNATURES = [
//    'event EnhancementRequested(uint256 indexed attemptId, address indexed user, uint256 indexed itemId, uint256 vrfRequestId)',
//    'event EnhancementResult(uint256 indexed attemptId, address indexed user, uint256 indexed itemId, uint256 vrfRequestId, uint8 beforeLevel, uint8 afterLevel, uint8 resultType, uint16 successRateBps, uint256 randomValue)',
//    'event ProbabilityTableUpdated(address indexed updater, uint8 indexed level, uint8 indexed enhancementType, uint16 oldSuccessRateBps, uint16 newSuccessRateBps)',
//  ];
// ------------------------------------------------------------

const BASE_HANDLERS = {
  EnhancementRequested: handleEnhancementRequested,
  EnhancementResult: handleEnhancementResult,
  ProbabilityTableUpdated: handleProbabilityTableUpdated,
};

// v4: 고급강화 컨트랙트 이벤트 핸들러
const ADVANCED_HANDLERS = {
  AdvancedEnhancementRequested: handleAdvancedEnhancementRequested,
  AdvancedEnhancementResult: handleAdvancedEnhancementResult,
  AdvancedRateUpdated: handleAdvancedRateUpdated,
};

// v5: 업적 NFT 컨트랙트 이벤트 핸들러 (온체인 판정 업적 ID 1, 2)
const ACHIEVEMENT_HANDLERS = {
  AchievementUnlocked: handleAchievementUnlocked,
};


// ============================================================
//  메인 루프
// ============================================================
async function main() {
  console.log('[indexer] 부팅 (v4 — base + 고급강화)');
  console.log('[indexer]   RPC          :', RPC_URL);
  console.log('[indexer]   BASE         :', CONTRACT_ADDRESS);
  console.log('[indexer]   ADVANCED     :', ADVANCED_CONTRACT_ADDRESS || '(미설정 — base 만 구독)');
  console.log('[indexer]   ACHIEVEMENTS :', ACHIEVEMENTS_NFT_ADDRESS || '(미설정 — 업적 이벤트 구독 제외)');
  console.log('[indexer]   BATCH_SIZE   :', BATCH_SIZE);
  console.log('[indexer]   CONFIRM_BLKS :', CONFIRMATION_BLOCKS);

  if (!RPC_URL) throw new Error('RPC_URL not set — check backend/.env');
  if (!CONTRACT_ADDRESS) throw new Error('CONTRACT_ADDRESS not set — check backend/.env');

  const provider = new ethers.JsonRpcProvider(RPC_URL);

  // 구독할 컨트랙트 소스. 주소가 없는 소스는 자동 제외(하위호환).
  // 컨트랙트마다 ABI 가 다르므로 iface 도 소스별로 둔다.
  const sources = [
    { name: 'base',         address: CONTRACT_ADDRESS,          iface: new ethers.Interface(BASE_ABI),          handlers: BASE_HANDLERS },
    { name: 'advanced',     address: ADVANCED_CONTRACT_ADDRESS, iface: new ethers.Interface(ADV_ABI),           handlers: ADVANCED_HANDLERS },
    { name: 'achievements', address: ACHIEVEMENTS_NFT_ADDRESS,  iface: new ethers.Interface(ACHIEVEMENTS_ABI),  handlers: ACHIEVEMENT_HANDLERS },
  ].filter((s) => s.address);

  // log.address(소문자) → source 빠른 조회용
  const sourceByAddress = new Map(sources.map((s) => [s.address.toLowerCase(), s]));

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await tick(provider, sources, sourceByAddress);
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
async function tick(provider, sources, sourceByAddress) {
  const latest = await provider.getBlockNumber();
  const safeHead = latest - CONFIRMATION_BLOCKS;

  let from = (await loadCursor()) + 1;
  if (from > safeHead) return;   // 새 확정 블록 없음

  // block.timestamp 캐시 (한 tick 내에서만 유효)
  const blockTsCache = new Map();

  // 두 컨트랙트를 한 번의 getLogs 로 동시 구독 (ethers 는 address 배열 지원)
  const addresses = sources.map((s) => s.address);

  while (from <= safeHead) {
    const to = Math.min(from + BATCH_SIZE - 1, safeHead);
    console.log(`[indexer] 처리 범위: ${from} → ${to} (safeHead=${safeHead})`);

    const logs = await provider.getLogs({
      address: addresses,
      fromBlock: from,
      toBlock: to,
    });

    for (const log of logs) {
      await dispatch(sourceByAddress, log, provider, blockTsCache);
    }

    await saveCursor(to);
    from = to + 1;
  }
}


/**
 * 단일 로그 디코딩 + 핸들러 분기. ABI 에 없는 이벤트는 무시.
 */
async function dispatch(sourceByAddress, log, provider, blockTsCache) {
  // 어느 컨트랙트에서 온 로그인지 판별 → 그 소스의 iface/handlers 사용
  const source = sourceByAddress.get(log.address.toLowerCase());
  if (!source) return;   // 구독 대상 외 주소 (방어)

  let parsed;
  try {
    parsed = source.iface.parseLog({ topics: log.topics, data: log.data });
  } catch {
    return;   // 알 수 없는 이벤트는 안전하게 무시
  }
  if (!parsed) return;

  const handler = source.handlers[parsed.name];
  if (!handler) {
    console.warn(`[indexer] 핸들러 없음: ${source.name}.${parsed.name}`);
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
  let processed = false;   // v5: 이 이벤트가 "새로" 처리됐는지 (중복 재처리면 업적 훅 스킵)
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
    processed = true;

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

  // ── v5: 오프체인 업적 판정 훅 (ID 3, 4, 5) ──────────────────
  //  새로 완료된 시도가 있을 때만, "해당 유저만" 검사한다 (전체 스캔 금지).
  //  판정·mint 실패가 인덱싱(커서 진행)을 막으면 안 되므로 오류는 로그만 남긴다 —
  //  놓친 mint 는 processPendingMints 재시도 경로가 회수한다.
  if (processed) {
    const user = args.user.toLowerCase();
    try {
      const newly = await checkOffchainAchievements(db, user);
      for (const row of newly) {
        await mintDetected(db, row);
      }
    } catch (err) {
      console.error('[indexer] 업적 판정 훅 오류:', err.message);
    }
  }
}


/**
 * (v5) AchievementUnlocked → achievements INSERT (온체인 판정 업적 ID 1, 2)
 *
 *  args: { user, achievementId, itemId }
 *  판정 경계: 컨트랙트가 이미 판정·발급까지 끝낸 이벤트다 — 백엔드 재판정 금지,
 *  기록만 한다. NFT 가 이미 발급됐으므로 status 는 바로 'minted'.
 *  멱등성: UNIQUE(wallet, achievement_id) + ON CONFLICT DO NOTHING (재인덱싱 안전).
 */
async function handleAchievementUnlocked(args, meta) {
  await db.query(`
    INSERT INTO achievements
      (wallet, achievement_id, source, item_id,
       tx_hash, log_index, block_number, status, minted_at)
    VALUES ($1, $2, 'onchain', $3, $4, $5, $6, 'minted', $7)
    ON CONFLICT (wallet, achievement_id) DO NOTHING
  `, [
    args.user.toLowerCase(),
    Number(args.achievementId),
    args.itemId.toString(),
    meta.txHash, meta.logIndex, meta.blockNumber, meta.blockTimestamp,
  ]);
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
//  고급강화(상급) 이벤트 핸들러 — v4
//  대상: AdvancedEnhancementGameVRF (base 를 참조하는 별도 컨트랙트)
// ============================================================

/**
 * (A) AdvancedEnhancementRequested → advanced_attempts UPSERT (status='pending')
 *
 *  args: { attemptId, user, itemId, vrfRequestId, mode,
 *          beforeExtraLevel, beforeTotalLevel, beforeSafeDropStreak, guaranteed }
 *
 *  base Requested 와 동일하게, Result 가 먼저 도착했을 수 있어 충돌 시
 *  requested_* 및 before_* 메타만 COALESCE 로 채운다.
 *  ※ Guaranteed 는 Requested+Result 가 같은 tx 에서 동시 emit (vrfRequestId=0).
 */
async function handleAdvancedEnhancementRequested(args, meta) {
  await db.query(`
    INSERT INTO advanced_attempts
      (attempt_id, user_address, item_id, mode,
       before_extra_level, before_total_level, before_safe_drop_streak, guaranteed,
       vrf_request_id, status,
       requested_tx_hash, requested_log_index, requested_block, requested_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending', $10, $11, $12, $13)
    ON CONFLICT (attempt_id) DO UPDATE
      SET mode                    = COALESCE(advanced_attempts.mode, EXCLUDED.mode),
          before_extra_level      = COALESCE(advanced_attempts.before_extra_level, EXCLUDED.before_extra_level),
          before_total_level      = COALESCE(advanced_attempts.before_total_level, EXCLUDED.before_total_level),
          before_safe_drop_streak = COALESCE(advanced_attempts.before_safe_drop_streak, EXCLUDED.before_safe_drop_streak),
          guaranteed              = COALESCE(advanced_attempts.guaranteed, EXCLUDED.guaranteed),
          vrf_request_id          = COALESCE(advanced_attempts.vrf_request_id, EXCLUDED.vrf_request_id),
          requested_tx_hash       = COALESCE(advanced_attempts.requested_tx_hash, EXCLUDED.requested_tx_hash),
          requested_log_index     = COALESCE(advanced_attempts.requested_log_index, EXCLUDED.requested_log_index),
          requested_block         = COALESCE(advanced_attempts.requested_block, EXCLUDED.requested_block),
          requested_at            = COALESCE(advanced_attempts.requested_at, EXCLUDED.requested_at),
          updated_at              = NOW()
  `, [
    args.attemptId.toString(),
    args.user.toLowerCase(),
    args.itemId.toString(),
    Number(args.mode),
    Number(args.beforeExtraLevel),
    Number(args.beforeTotalLevel),
    Number(args.beforeSafeDropStreak),
    Boolean(args.guaranteed),
    args.vrfRequestId.toString(),
    meta.txHash, meta.logIndex, meta.blockNumber, meta.blockTimestamp,
  ]);
}


/**
 * (B) AdvancedEnhancementResult → advanced_attempts UPSERT + user_items 갱신 (★ 한 트랜잭션)
 *
 *  args: { attemptId, user, itemId, vrfRequestId, mode,
 *          beforeExtraLevel, afterExtraLevel, beforeTotalLevel, afterTotalLevel,
 *          resultType, beforeSafeDropStreak, afterSafeDropStreak, guaranteed,
 *          successRateBps, destroyRateBps, randomValue, rollBps }
 *
 *  멱등성: WHERE status='pending' 가드 → 이미 'completed' 면 SKIP(user_items 중복 갱신 방지).
 *  user_items: base 가 관리하는 level/total_attempts 는 건드리지 않고 extra_level 만 갱신.
 *              (total_level 은 generated 라 자동 재계산)
 */
async function handleAdvancedEnhancementResult(args, meta) {
  await db.withTransaction(async (tx) => {
    const attemptId = args.attemptId.toString();
    const user = args.user.toLowerCase();
    const itemId = args.itemId.toString();
    const afterExtraLevel = Number(args.afterExtraLevel);
    const afterTotalLevel = Number(args.afterTotalLevel);

    // 1) advanced_attempts UPSERT (completed)
    const upsert = await tx.query(`
      INSERT INTO advanced_attempts
        (attempt_id, user_address, item_id, mode,
         before_extra_level, after_extra_level, before_total_level, after_total_level,
         result_type, before_safe_drop_streak, after_safe_drop_streak, guaranteed,
         success_rate_bps, destroy_rate_bps, random_value, roll_bps,
         vrf_request_id, status,
         completed_tx_hash, completed_log_index, completed_block, completed_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'completed',$18,$19,$20,$21)
      ON CONFLICT (attempt_id) DO UPDATE
        SET mode                    = EXCLUDED.mode,
            before_extra_level      = EXCLUDED.before_extra_level,
            after_extra_level       = EXCLUDED.after_extra_level,
            before_total_level      = EXCLUDED.before_total_level,
            after_total_level       = EXCLUDED.after_total_level,
            result_type             = EXCLUDED.result_type,
            before_safe_drop_streak = EXCLUDED.before_safe_drop_streak,
            after_safe_drop_streak  = EXCLUDED.after_safe_drop_streak,
            guaranteed              = EXCLUDED.guaranteed,
            success_rate_bps        = EXCLUDED.success_rate_bps,
            destroy_rate_bps        = EXCLUDED.destroy_rate_bps,
            random_value            = EXCLUDED.random_value,
            roll_bps                = EXCLUDED.roll_bps,
            vrf_request_id          = COALESCE(advanced_attempts.vrf_request_id, EXCLUDED.vrf_request_id),
            status                  = 'completed',
            completed_tx_hash       = EXCLUDED.completed_tx_hash,
            completed_log_index     = EXCLUDED.completed_log_index,
            completed_block         = EXCLUDED.completed_block,
            completed_at            = EXCLUDED.completed_at,
            updated_at              = NOW()
        WHERE advanced_attempts.status = 'pending'
      RETURNING attempt_id
    `, [
      attemptId, user, itemId, Number(args.mode),
      Number(args.beforeExtraLevel), afterExtraLevel,
      Number(args.beforeTotalLevel), afterTotalLevel,
      Number(args.resultType), Number(args.beforeSafeDropStreak), Number(args.afterSafeDropStreak),
      Boolean(args.guaranteed),
      Number(args.successRateBps), Number(args.destroyRateBps),
      args.randomValue.toString(), Number(args.rollBps),
      args.vrfRequestId.toString(),
      meta.txHash, meta.logIndex, meta.blockNumber, meta.blockTimestamp,
    ]);

    if (upsert.rowCount === 0) {
      // 이미 처리된 Result — user_items 갱신 SKIP
      return;
    }

    // 2) user_items 의 extra_level 갱신 (level/total_attempts 는 base 전용)
    //    행이 없을 때만 INSERT (base level = afterTotalLevel - afterExtraLevel = 5)
    const baseLevel = afterTotalLevel - afterExtraLevel;
    await tx.query(`
      INSERT INTO user_items
        (user_address, item_id, level, extra_level, total_attempts,
         last_tx_hash, last_log_index, last_block, last_updated_at)
      VALUES ($1, $2, $3, $4, 0, $5, $6, $7, $8)
      ON CONFLICT (user_address, item_id) DO UPDATE
        SET extra_level     = EXCLUDED.extra_level,
            last_tx_hash    = EXCLUDED.last_tx_hash,
            last_log_index  = EXCLUDED.last_log_index,
            last_block      = EXCLUDED.last_block,
            last_updated_at = EXCLUDED.last_updated_at,
            updated_at      = NOW()
        -- reorg-safe: 이미 더 큰 block 의 갱신이 있으면 덮어쓰지 않음
        WHERE user_items.last_block <= EXCLUDED.last_block
    `, [
      user, itemId, baseLevel, afterExtraLevel,
      meta.txHash, meta.logIndex, meta.blockNumber, meta.blockTimestamp,
    ]);
  });
}


/**
 * (C) AdvancedRateUpdated → advanced_rate_history INSERT
 *
 *  args: { updater, mode, extraLevel,
 *          oldSuccessRateBps, newSuccessRateBps, oldDestroyRateBps, newDestroyRateBps }
 *  on_chain_timestamp 은 이벤트에 없음 → meta.blockTimestamp 사용.
 */
async function handleAdvancedRateUpdated(args, meta) {
  await db.query(`
    INSERT INTO advanced_rate_history
      (updater, mode, extra_level,
       old_success_rate, new_success_rate, old_destroy_rate, new_destroy_rate,
       on_chain_timestamp, tx_hash, log_index, block_number)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    ON CONFLICT (tx_hash, log_index) DO NOTHING
  `, [
    args.updater.toLowerCase(),
    Number(args.mode),
    Number(args.extraLevel),
    Number(args.oldSuccessRateBps),
    Number(args.newSuccessRateBps),
    Number(args.oldDestroyRateBps),
    Number(args.newDestroyRateBps),
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
  BASE_ABI,
  ADV_ABI,
  ACHIEVEMENTS_ABI,
  baseHandlers: BASE_HANDLERS,
  advancedHandlers: ADVANCED_HANDLERS,
  achievementHandlers: ACHIEVEMENT_HANDLERS,
};

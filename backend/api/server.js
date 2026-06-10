/**
 * ============================================================
 *  REST API 서버 (Express) — v3 (배포본 일치화)
 * ============================================================
 *
 *  목적
 *  ----
 *  인덱서가 채워둔 PostgreSQL 데이터를 외부(프론트엔드 데모,
 *  발표 대시보드)에 노출한다.
 *
 *  V2 → V3 변경 요약 (배포본 일치화)
 *  --------------------------------
 *   - 컬럼명: randomness_request_id → vrf_request_id  (bytes32 → uint256)
 *   - 응답 필드: randomnessRequestId → vrfRequestId
 *   - 그 외 라우트 구조/응답 형태는 V2 와 동일
 *     (attempts 단일 소스, status enum 'completed').
 *   - 자세한 배경: docs/events.md 의 V2 → V3 차이 매핑 참고.
 *
 *  설계 원칙
 *  ---------
 *  - 모든 경로는 `/api/*` prefix 로 통일 (`/health` 제외).
 *  - 응답은 항상 JSON. 에러 응답도 { error, message? } 형태로 통일.
 *  - 데이터 가공(통계 검정 등)은 SQL 한 방으로 처리하기보다,
 *    `utils/stats.js` 의 순수 함수로 분리하여 단위 테스트 가능하도록 둔다.
 *  - DB 풀은 lazy singleton (`db/pool.js`). 라우트 핸들러는 throw 시
 *    하단 공통 에러 핸들러로 흘려보낸다.
 *
 *  엔드포인트 요약 (★ = 차별화 포인트와 직접 연결)
 *  ----------------------------------------------
 *   GET /health                          서버/DB 헬스체크
 *
 *   GET /api/stats/by-level              ★ 단계별 표기 vs 실측 + 통계 검정
 *   GET /api/stats/global                전체 누적 통계
 *   GET /api/stats/user/:address         사용자별 시도 통계 + 보유 아이템
 *
 *   GET /api/attempts/recent             최근 시도 목록 (대시보드용)
 *   GET /api/attempts/:attemptId         ★ 시도 1건 상세 + VRF 재검증 결과
 *
 *   GET /api/probability/history         ★ 확률표 변경 이력
 *
 *   GET /api/merkle/proof                allowlist Merkle proof 발급 (프론트 강화 요청 지원)
 *
 *   GET /api/advanced/attempts/recent    고급강화 최근 시도 목록
 *   GET /api/advanced/attempts/:id       ★ 고급강화 시도 1건 + 재검증 (T5)
 *   GET /api/advanced/stats              ★ 고급강화 모드·단계별 통계 검정 (T6)
 *   GET /api/ranking                     랭킹 — 최고단계 아이템 / 도전왕 / 성공왕 (T7)
 *
 *   GET /api/achievements/:address       업적 NFT 발급 여부 조회 (T10, RPC read-on-demand)
 *
 *  ※ 차별화 포인트 매핑
 *     #1 통계 검정 (Wilson 95% CI + 카이제곱 p-value)
 *        → /api/stats/by-level, /api/stats/global, /api/stats/user/:address
 *     #2 VRF 재검증 (off-chain re-derivation)
 *        → /api/attempts/:attemptId
 *     #3 확률표 변경 추적
 *        → /api/probability/history
 * ============================================================
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');

const db = require('../db/pool');
const { summarizeLevel, rateToBp } = require('../utils/stats');
const { verifySuccess, normalizeAddress } = require('../utils/verify');
const { summarizeAdvancedSafe, summarizeAdvancedRisky } = require('../utils/advancedStats');
const {
  verifyAdvancedAttempt, fromDbRow: advFromDbRow, RESULT_LABEL,
} = require('../utils/advancedVerify');
const merkle = require('../utils/merkle');
const { createAchievementsClient } = require('../utils/achievements');

const app = express();
const PORT = Number(process.env.PORT || 3000);

// ------------------------------------------------------------
//  공통 미들웨어
// ------------------------------------------------------------
//  CORS: 발표 데모 페이지(별도 도메인)에서 호출할 수 있도록 전체 허용.
//  운영 환경에선 origin 화이트리스트로 좁힐 것.
app.use(cors());
app.use(express.json());

// 간이 요청 로거 (placeholder — 추후 morgan 도입 가능)
app.use((req, _res, next) => {
  console.log(`[api] ${req.method} ${req.url}`);
  next();
});


// ------------------------------------------------------------
//  헬스체크 — DB ping 포함
// ------------------------------------------------------------
app.get('/health', async (_req, res) => {
  let dbOk = false;
  let dbError;
  try {
    await db.query('SELECT 1');
    dbOk = true;
  } catch (err) {
    dbError = err.message;
    console.error('[api] /health DB ping 실패:', err.message);
  }
  res.status(dbOk ? 200 : 503).json({
    status: dbOk ? 'ok' : 'degraded',
    service: 'khu-blockchain-backend',
    version: '4.0',
    db: dbOk,
    dbError,
    timestamp: new Date().toISOString(),
  });
});


// ============================================================
//  /api/stats/* — 통계 검정 계열 (차별화 #1)
// ============================================================

/**
 * GET /api/stats/by-level   ★ 메인 엔드포인트
 *
 *  반환 형식
 *  ---------
 *  { levels: [{ beforeLevel, declaredRateBp, observedSuccess, observedTotal,
 *               observedRateBp, wilson95:{lowBp,highBp},
 *               chiSquare:{stat,pValue}, fairnessVerdict }, ...] }
 *
 *  fairnessVerdict 결정 규칙 (utils/stats.js:fairnessVerdict)
 *   - observedTotal < 30   → 'insufficient_data'
 *   - p < 0.01             → 'suspicious'
 *   - 그 외                 → 'plausible'
 *
 *  declaredBp 출처
 *  ---------------
 *  attempts.claimed_success_rate 는 시도 시점에 컨트랙트가 적용한 값.
 *  같은 before_level 에서 확률표가 도중에 바뀌었다면 평균이 의미를 잃을 수 있으나,
 *  V2 단순화 단계에선 단일 평균값을 declaredRateBp 로 노출한다.
 *  (확률 변경 이력은 별도 /api/probability/history 로 제공)
 */
app.get('/api/stats/by-level', async (_req, res, next) => {
  try {
    const { rows } = await db.query(`
      SELECT before_level::int                            AS "beforeLevel",
             AVG(claimed_success_rate)::int               AS "declaredBp",
             COUNT(*) FILTER (WHERE success)::int         AS hits,
             COUNT(*)::int                                AS total
        FROM attempts
       WHERE status = 'completed'
       GROUP BY before_level
       ORDER BY before_level
    `);
    res.json({ levels: rows.map(summarizeLevel) });
  } catch (err) {
    next(err);
  }
});

/** GET /api/stats/global — 전체 누적 통계 */
app.get('/api/stats/global', async (_req, res, next) => {
  try {
    const { rows } = await db.query(`
      SELECT COUNT(*)::int                                                    AS completed,
             COUNT(*) FILTER (WHERE success)::int                             AS hits,
             COUNT(DISTINCT user_address)::int                                AS unique_users,
             COALESCE(AVG(EXTRACT(EPOCH FROM (completed_at - requested_at))),
                      0)::float                                               AS avg_vrf_latency_sec
        FROM attempts
       WHERE status = 'completed'
    `);
    const r = rows[0];
    res.json({
      completedAttempts: r.completed,
      successes: r.hits,
      observedRateBp: r.completed > 0 ? rateToBp(r.hits / r.completed) : 0,
      uniqueUsers: r.unique_users,
      avgVrfLatencySec: r.avg_vrf_latency_sec,
    });
  } catch (err) {
    next(err);
  }
});

/** GET /api/stats/user/:address — 사용자별 시도 통계 + 보유 아이템 현황 */
app.get('/api/stats/user/:address', async (req, res, next) => {
  const address = normalizeAddress(req.params.address);
  if (!address) {
    return res.status(400).json({
      error: 'invalid_address',
      message: 'address must match /^0x[a-fA-F0-9]{40}$/',
    });
  }
  try {
    const [statsResult, itemsResult] = await Promise.all([
      db.query(`
        SELECT COUNT(*)::int                            AS total,
               COUNT(*) FILTER (WHERE success)::int     AS hits
          FROM attempts
         WHERE user_address = $1 AND status = 'completed'
      `, [address]),
      db.query(`
        SELECT item_id, level, total_attempts, last_updated_at
          FROM user_items
         WHERE user_address = $1
         ORDER BY item_id
      `, [address]),
    ]);
    const s = statsResult.rows[0];
    res.json({
      address,
      completedAttempts: s.total,
      successes: s.hits,
      observedRateBp: s.total > 0 ? rateToBp(s.hits / s.total) : 0,
      items: itemsResult.rows.map((row) => ({
        itemId: row.item_id,
        level: row.level,
        totalAttempts: row.total_attempts,
        lastUpdatedAt: row.last_updated_at,
      })),
    });
  } catch (err) {
    next(err);
  }
});


// ============================================================
//  /api/attempts/* — 시도 조회 + VRF 재검증 (차별화 #2)
// ============================================================

/**
 * GET /api/attempts/recent — 최근 시도 목록 (limit=20 default, max=100)
 *
 *  쿼리: ?user=<address>  (선택) — 특정 유저의 시도만 필터.
 *        대시보드는 user 없이 전체, "내 기록" 페이지는 ?user=<지갑주소>로 호출.
 */
app.get('/api/attempts/recent', async (req, res, next) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);

  // ?user 가 오면 주소 검증. 빈 값/오타 주소는 400 (전체로 조용히 넘어가지 않음).
  let user = null;
  if (req.query.user !== undefined) {
    user = normalizeAddress(req.query.user);
    if (!user) {
      return res.status(400).json({
        error: 'invalid_address',
        message: 'user must match /^0x[a-fA-F0-9]{40}$/',
      });
    }
  }

  try {
    const params = [limit];
    let whereClause = '';
    if (user) {
      params.push(user);
      whereClause = 'WHERE user_address = $2';
    }
    const { rows } = await db.query(`
      SELECT attempt_id, user_address, item_id, before_level, after_level,
             claimed_success_rate, success, vrf_request_id, random_value,
             status, requested_at, completed_at,
             requested_tx_hash, completed_tx_hash
        FROM attempts
       ${whereClause}
       ORDER BY requested_at DESC
       LIMIT $1
    `, params);
    res.json({ limit, user, attempts: rows.map(formatAttempt) });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/attempts/:attemptId   ★ VRF 재검증 엔드포인트
 *
 *  반환 형식 (V2)
 *  --------------
 *  {
 *    attempt: { ..., randomnessRequestId, randomValue },
 *    verification: {                  // status='completed' 인 경우만, 아니면 null
 *      successDerived: boolean,        // (randomValue % 10000) < claimedSuccessRate
 *      matchesContract: boolean,       // successDerived === attempt.success
 *      formula: string,                // 사용된 공식 (가시화)
 *    } | null
 *  }
 */
app.get('/api/attempts/:attemptId', async (req, res, next) => {
  const { attemptId } = req.params;
  if (!/^\d+$/.test(attemptId)) {
    return res.status(400).json({ error: 'invalid_attempt_id' });
  }
  try {
    const { rows } = await db.query(`
      SELECT attempt_id, user_address, item_id, before_level, after_level,
             claimed_success_rate, success, vrf_request_id, random_value,
             status, requested_at, completed_at,
             requested_tx_hash, completed_tx_hash
        FROM attempts
       WHERE attempt_id = $1
    `, [attemptId]);

    if (rows.length === 0) {
      return res.status(404).json({ error: 'attempt_not_found', attemptId });
    }

    const row = rows[0];
    const attempt = formatAttempt(row);

    let verification = null;
    if (row.status === 'completed' && row.random_value != null) {
      const successDerived = verifySuccess(row.random_value, row.claimed_success_rate);
      verification = {
        successDerived,
        matchesContract: successDerived === row.success,
        formula: '(randomValue % 10000) < claimedSuccessRate',
      };
    }

    res.json({ attempt, verification });
  } catch (err) {
    next(err);
  }
});


// ============================================================
//  /api/probability/* — 확률표 변경 추적 (차별화 #3)
// ============================================================

/**
 * GET /api/probability/history
 *
 *  쿼리: ?level=7  (선택) — 특정 단계만 필터.
 *  반환: 변경 이력 시간순(최신 → 과거).
 */
app.get('/api/probability/history', async (req, res, next) => {
  let level = null;
  if (req.query.level !== undefined) {
    const parsed = Number(req.query.level);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 255) {
      return res.status(400).json({ error: 'invalid_level' });
    }
    level = parsed;
  }
  try {
    const { rows } = await db.query(`
      SELECT level, old_success_rate, new_success_rate,
             on_chain_timestamp, tx_hash, log_index, block_number
        FROM probability_history
       WHERE ($1::int IS NULL OR level = $1)
       ORDER BY block_number DESC
    `, [level]);
    res.json({
      level,
      history: rows.map((row) => ({
        level: row.level,
        oldSuccessRateBp: row.old_success_rate,
        newSuccessRateBp: row.new_success_rate,
        onChainTimestamp: row.on_chain_timestamp,
        txHash: row.tx_hash,
        logIndex: row.log_index,
        blockNumber: Number(row.block_number),
      })),
    });
  } catch (err) {
    next(err);
  }
});


// ============================================================
//  /api/merkle/* — allowlist Merkle proof 발급
//  (차별화 포인트는 아니지만, merkleRoot 게이트 때문에 프론트 강화 요청에 필수)
// ============================================================

/**
 * GET /api/merkle/proof?user=0x..&itemId=123&type=0
 *
 *  컨트랙트 merkleRoot 가 설정돼 있어, 등록된 (user, itemId, type) 만
 *  `requestEnhancementWithProof(itemId, type, proof)` 로 강화 가능하다.
 *  프론트가 이 proof 를 컨트랙트에 넘기도록 발급한다.
 *
 *  반환
 *  ----
 *   200 { user, itemId, type, registered:true, leaf, proof:[...], root }
 *   404 { error:'not_registered', ... }   ← allowlist 에 없음 (강화 불가)
 *   400 { error:'invalid_*' }              ← 입력 형식 오류
 *
 *  proof 는 컨트랙트 `MerkleProof.sol` / `isValidEnhancementProof` 와 100% 호환
 *  (utils/merkle.js 가 온체인 root 로 자가검증된 트리에서 생성).
 */
app.get('/api/merkle/proof', (req, res, next) => {
  const user = normalizeAddress(req.query.user);
  if (!user) {
    return res.status(400).json({ error: 'invalid_address', message: 'user must match /^0x[a-fA-F0-9]{40}$/' });
  }

  if (req.query.itemId === undefined) {
    return res.status(400).json({ error: 'missing_itemId', message: 'itemId query param required' });
  }
  let itemId;
  try {
    itemId = BigInt(req.query.itemId);
    if (itemId < 0n) throw new Error('negative');
  } catch {
    return res.status(400).json({ error: 'invalid_itemId', message: 'itemId must be a non-negative integer' });
  }

  let type = 0;
  if (req.query.type !== undefined) {
    const t = Number(req.query.type);
    if (!Number.isInteger(t) || t < 0 || t > 255) {
      return res.status(400).json({ error: 'invalid_type', message: 'type must be an integer 0..255' });
    }
    type = t;
  }

  try {
    const { registered, leaf, proof } = merkle.getProof(user, itemId.toString(), type);
    const root = merkle.getRoot();
    if (!registered) {
      return res.status(404).json({
        error: 'not_registered',
        message: '해당 (user, itemId, type) 는 allowlist(merkleRoot)에 없어 강화 불가',
        user, itemId: itemId.toString(), type, leaf, root,
      });
    }
    return res.json({ user, itemId: itemId.toString(), type, registered: true, leaf, proof, root });
  } catch (err) {
    return next(err);
  }
});


// ============================================================
//  /api/advanced/* — 고급강화(상급) 시도 조회 + 재검증 (T5) / 통계 (T6)
// ============================================================

const ADV_ATTEMPT_COLUMNS = `
  attempt_id, user_address, item_id, mode,
  before_extra_level, after_extra_level, before_total_level, after_total_level,
  result_type, before_safe_drop_streak, after_safe_drop_streak, guaranteed,
  success_rate_bps, destroy_rate_bps, random_value, roll_bps, vrf_request_id,
  status, requested_at, completed_at, requested_tx_hash, completed_tx_hash`;

/**
 * GET /api/advanced/attempts/recent — 최근 고급강화 시도 (limit=20 default, max=100)
 *  쿼리: ?user=<address> (선택) — 특정 유저만.
 *  ※ /:attemptId 보다 먼저 정의해야 'recent' 가 attemptId 로 안 잡힌다.
 */
app.get('/api/advanced/attempts/recent', async (req, res, next) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
  let user = null;
  if (req.query.user !== undefined) {
    user = normalizeAddress(req.query.user);
    if (!user) {
      return res.status(400).json({ error: 'invalid_address', message: 'user must match /^0x[a-fA-F0-9]{40}$/' });
    }
  }
  try {
    const params = [limit];
    let whereClause = '';
    if (user) { params.push(user); whereClause = 'WHERE user_address = $2'; }
    const { rows } = await db.query(`
      SELECT ${ADV_ATTEMPT_COLUMNS}
        FROM advanced_attempts
       ${whereClause}
       ORDER BY requested_at DESC NULLS LAST
       LIMIT $1
    `, params);
    res.json({ limit, user, attempts: rows.map(formatAdvancedAttempt) });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/advanced/attempts/:attemptId   ★ 고급강화 재검증 엔드포인트 (T5)
 *
 *  반환: { attempt, verification }
 *    verification (status='completed' 인 경우만, 아니면 null):
 *      { ok, expected, actual, checks, mismatches }
 *      — utils/advancedVerify.verifyAdvancedAttempt 로 컨트랙트 산출 로직 재현·대조.
 */
app.get('/api/advanced/attempts/:attemptId', async (req, res, next) => {
  const { attemptId } = req.params;
  if (!/^\d+$/.test(attemptId)) {
    return res.status(400).json({ error: 'invalid_attempt_id' });
  }
  try {
    const { rows } = await db.query(`
      SELECT ${ADV_ATTEMPT_COLUMNS}
        FROM advanced_attempts
       WHERE attempt_id = $1
    `, [attemptId]);

    if (rows.length === 0) {
      return res.status(404).json({ error: 'attempt_not_found', attemptId });
    }

    const row = rows[0];
    let verification = null;
    if (row.status === 'completed' && row.result_type != null) {
      verification = verifyAdvancedAttempt(advFromDbRow(row));
    }
    res.json({ attempt: formatAdvancedAttempt(row), verification });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/advanced/stats   ★ 고급강화 통계 (T6)
 *
 *  (mode, extraLevel, 적용확률) 그룹별로 표기 vs 실측 + 검정.
 *   - Safe : 성공 vs 비성공 (이항, 1df)
 *   - Risky: 성공/파괴/유지 (다항, 2df)
 *   - 보장(Guaranteed) 표본은 확률 사건이 아니므로 제외(guaranteed=false).
 *
 *  반환: { safe: [...summarizeAdvancedSafe], risky: [...summarizeAdvancedRisky] }
 */
app.get('/api/advanced/stats', async (_req, res, next) => {
  try {
    const { rows } = await db.query(`
      SELECT mode::int                                       AS mode,
             before_extra_level::int                         AS extra_level,
             success_rate_bps::int                           AS success_rate_bps,
             destroy_rate_bps::int                           AS destroy_rate_bps,
             COUNT(*)::int                                   AS total,
             COUNT(*) FILTER (WHERE result_type = 1)::int    AS success,
             COUNT(*) FILTER (WHERE result_type = 3)::int    AS destroyed,
             COUNT(*) FILTER (WHERE result_type = 0)::int    AS fail_keep
        FROM advanced_attempts
       WHERE status = 'completed' AND guaranteed = false
       GROUP BY mode, before_extra_level, success_rate_bps, destroy_rate_bps
       ORDER BY mode, before_extra_level
    `);

    const safe = [];
    const risky = [];
    for (const r of rows) {
      if (r.mode === 0) {
        safe.push(summarizeAdvancedSafe({
          extraLevel: r.extra_level,
          declaredSuccessBp: r.success_rate_bps,
          success: r.success,
          total: r.total,
        }));
      } else {
        risky.push(summarizeAdvancedRisky({
          extraLevel: r.extra_level,
          declaredSuccessBp: r.success_rate_bps,
          declaredDestroyBp: r.destroy_rate_bps,
          success: r.success,
          destroyed: r.destroyed,
          failKeep: r.fail_keep,
          total: r.total,
        }));
      }
    }
    res.json({ safe, risky });
  } catch (err) {
    next(err);
  }
});


// ============================================================
//  /api/ranking — 랭킹 (T7)
// ============================================================

/**
 * GET /api/ranking?limit=10   (limit 1..100, default 10)
 *
 *  반환:
 *   {
 *     topItems:       [{ rank, userAddress, itemId, baseLevel, extraLevel, totalLevel }],
 *     topChallengers: [{ rank, userAddress, attempts }],   // base + advanced 시도 합
 *     topSuccess:     [{ rank, userAddress, successes }],   // base 성공 + advanced 성공(1,4) 합
 *   }
 *
 *  ※ 모두 온체인 인덱싱 데이터에서 누구나 재계산 가능 — 신뢰 불필요.
 *    advanced 성공 = resultType Success(1) 또는 Guaranteed(4) (레벨 상승).
 */
app.get('/api/ranking', async (req, res, next) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 100);
  try {
    const [items, challengers, success] = await Promise.all([
      db.query(`
        SELECT user_address, item_id, level, extra_level, total_level
          FROM user_items
         ORDER BY total_level DESC, level DESC, item_id ASC
         LIMIT $1
      `, [limit]),
      db.query(`
        SELECT user_address, SUM(cnt)::int AS attempts
          FROM (
            SELECT user_address, COUNT(*) AS cnt FROM attempts          WHERE status='completed' GROUP BY user_address
            UNION ALL
            SELECT user_address, COUNT(*) AS cnt FROM advanced_attempts WHERE status='completed' GROUP BY user_address
          ) t
         GROUP BY user_address
         ORDER BY attempts DESC
         LIMIT $1
      `, [limit]),
      db.query(`
        SELECT user_address, SUM(cnt)::int AS successes
          FROM (
            SELECT user_address, COUNT(*) FILTER (WHERE success) AS cnt
              FROM attempts WHERE status='completed' GROUP BY user_address
            UNION ALL
            SELECT user_address, COUNT(*) FILTER (WHERE result_type IN (1,4)) AS cnt
              FROM advanced_attempts WHERE status='completed' GROUP BY user_address
          ) t
         GROUP BY user_address
         ORDER BY successes DESC
         LIMIT $1
      `, [limit]),
    ]);

    res.json({
      limit,
      topItems: items.rows.map((r, i) => ({
        rank: i + 1,
        userAddress: r.user_address,
        itemId: r.item_id,
        baseLevel: r.level,
        extraLevel: r.extra_level,
        totalLevel: r.total_level,
      })),
      topChallengers: challengers.rows.map((r, i) => ({
        rank: i + 1, userAddress: r.user_address, attempts: r.attempts,
      })),
      topSuccess: success.rows.map((r, i) => ({
        rank: i + 1, userAddress: r.user_address, successes: r.successes,
      })),
    });
  } catch (err) {
    next(err);
  }
});


// ============================================================
//  /api/achievements/* — 업적 NFT 발급 여부 조회 (T10)
// ============================================================

//  DB 를 거치지 않고 RPC view 호출로 즉석 조회한다 (utils/achievements.js
//  머리말 참고). RPC_URL / ACHIEVEMENT_CONTRACT_ADDRESS 미설정 환경에서도
//  서버 부팅은 막지 않고, 해당 라우트만 503 으로 응답한다.
const achievementsClient = createAchievementsClient({
  rpcUrl: process.env.RPC_URL,
  contractAddress: process.env.ACHIEVEMENT_CONTRACT_ADDRESS,
});

/**
 * GET /api/achievements/:address?itemId=72
 *
 *  반환
 *  ----
 *   200 {
 *     user, contract,
 *     achievements: [{ achievementId, key, label, description, claimed }],
 *     // ?itemId= 지정 시에만:
 *     itemId, canClaimMaxEnhancement,   // 해당 아이템으로 최대강화 업적 클레임 가능 여부
 *   }
 *   400 { error:'invalid_address' | 'invalid_itemId' }
 *   502 { error:'rpc_error' }                       ← RPC 장애 (우리 서버 문제 아님)
 *   503 { error:'achievements_not_configured' }     ← 환경변수 미설정
 */
app.get('/api/achievements/:address', async (req, res) => {
  if (!achievementsClient.isConfigured()) {
    return res.status(503).json({
      error: 'achievements_not_configured',
      message: 'RPC_URL / ACHIEVEMENT_CONTRACT_ADDRESS 환경변수가 필요합니다',
    });
  }

  const user = normalizeAddress(req.params.address);
  if (!user) {
    return res.status(400).json({ error: 'invalid_address', message: 'address must match /^0x[a-fA-F0-9]{40}$/' });
  }

  let itemId = null;
  if (req.query.itemId !== undefined) {
    try {
      itemId = BigInt(req.query.itemId);
      if (itemId < 0n) throw new Error('negative');
    } catch {
      return res.status(400).json({ error: 'invalid_itemId', message: 'itemId must be a non-negative integer' });
    }
  }

  try {
    const achievements = await achievementsClient.getUserAchievements(user);
    const out = { user, contract: achievementsClient.address, achievements };
    if (itemId !== null) {
      out.itemId = itemId.toString();
      out.canClaimMaxEnhancement = await achievementsClient.canClaimMaxEnhancement(user, itemId);
    }
    return res.json(out);
  } catch (err) {
    console.error('[api] /api/achievements RPC 오류:', err.message);
    return res.status(502).json({ error: 'rpc_error', message: err.message });
  }
});


// ============================================================
//  공통 어댑터: attempts 행 → API 응답 형식
// ============================================================
function formatAttempt(row) {
  return {
    attemptId: row.attempt_id,
    userAddress: row.user_address,
    itemId: row.item_id,
    beforeLevel: row.before_level,
    afterLevel: row.after_level,
    claimedSuccessRateBp: row.claimed_success_rate,
    success: row.success,
    vrfRequestId: row.vrf_request_id,
    randomValue: row.random_value,
    status: row.status,
    requestedAt: row.requested_at,
    completedAt: row.completed_at,
    requestedTxHash: row.requested_tx_hash,
    completedTxHash: row.completed_tx_hash,
  };
}

/** advanced_attempts 행 → API 응답 형식 */
function formatAdvancedAttempt(row) {
  return {
    attemptId: row.attempt_id,
    userAddress: row.user_address,
    itemId: row.item_id,
    mode: row.mode,
    modeLabel: row.mode === 0 ? 'safe' : row.mode === 1 ? 'risky' : null,
    beforeExtraLevel: row.before_extra_level,
    afterExtraLevel: row.after_extra_level,
    beforeTotalLevel: row.before_total_level,
    afterTotalLevel: row.after_total_level,
    resultType: row.result_type,
    resultLabel: row.result_type != null ? (RESULT_LABEL[row.result_type] ?? null) : null,
    beforeSafeDropStreak: row.before_safe_drop_streak,
    afterSafeDropStreak: row.after_safe_drop_streak,
    guaranteed: row.guaranteed,
    successRateBp: row.success_rate_bps,
    destroyRateBp: row.destroy_rate_bps,
    randomValue: row.random_value,
    rollBp: row.roll_bps,
    vrfRequestId: row.vrf_request_id,
    status: row.status,
    requestedAt: row.requested_at,
    completedAt: row.completed_at,
    requestedTxHash: row.requested_tx_hash,
    completedTxHash: row.completed_tx_hash,
  };
}


// ------------------------------------------------------------
//  공통 에러 핸들러 (라우트 매치 실패 + 라우트 내부 throw)
// ------------------------------------------------------------
app.use((_req, res) => {
  res.status(404).json({ error: 'not_found' });
});

app.use((err, _req, res, _next) => {
  console.error('[api] 처리 중 오류:', err);
  res.status(500).json({ error: 'internal_error', message: err.message });
});


// ------------------------------------------------------------
//  서버 시작
// ------------------------------------------------------------
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`[api] 서버 부팅 완료 (v4.0): http://localhost:${PORT}`);
    try {
      const m = merkle.getInfo();
      console.log(`[api]   merkle allowlist: ${m.count}개 등록, root=${m.root.slice(0, 12)}…, type=${m.enhancementType}`);
    } catch (e) {
      console.warn('[api]   ⚠️ merkle allowlist 로드 실패 — /api/merkle/proof 비활성:', e.message);
    }
  });
}

module.exports = app;

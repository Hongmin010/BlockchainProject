/**
 * ============================================================
 *  오프체인 업적 판정 모듈 (ID 3 공식인증 호구 / 4 천운 / 5 다둥이 집사)
 * ============================================================
 *
 *  판정 위치 경계: ID 1, 2 는 컨트랙트가 판정한다 — 이 모듈은 절대 다루지 않는다.
 *
 *  호출 시점: 인덱서가 EnhancementResult(완료) 를 처리한 직후 훅.
 *  ⚠️ 전체 유저 스캔 금지 — 방금 이벤트가 발생한 "해당 유저만" 검사한다.
 *
 *  ID 3/4 (운 판정) — utils/stats.js 의 Wilson 95% CI 재사용:
 *    - 기대 성공수 = 시도별 공시 확률(claimed_success_rate)의 합
 *      → 기대 성공률(bp) = SUM(claimed) / 시도수
 *    - 관측 성공률의 Wilson 95% CI 를 구해 기대 성공률과 비교:
 *        CI 상한 < 기대치 → ID 3 (유의하게 불운한 호구)
 *        CI 하한 > 기대치 → ID 4 (유의하게 운 좋은 천운)
 *    - 표본 LUCK_MIN_ATTEMPTS(30회) 미만이면 판정 스킵 (소표본 오탐 방지).
 *    - 3 과 4 는 구조상 상호배타 (lowBp ≤ highBp 이므로 동시 성립 불가).
 *
 *  ID 5 (다둥이 집사):
 *    - user_items 에서 total_level ≥ 10 인 고양이 수 ≥ 5.
 *      (스펙 표기 "level>=10" 의 level 컬럼은 base 단계 0~5 라 10 불가 —
 *       "10강"의 실제 의미인 total_level(base+extra, GENERATED) 을 사용)
 *
 *  감지 시: payload(근거 원본) + dataHash 를 achievements 에 'detected' 로 INSERT.
 *  UNIQUE(wallet, achievement_id) + ON CONFLICT DO NOTHING → 중복 발급 원천 차단.
 *  mint 호출은 lib/achievementMint.js 의 몫 (이 모듈은 판정·기록까지만).
 */

const {
  ACHIEVEMENT_IDS,
  LUCK_MIN_ATTEMPTS,
  CAT_BUTLER_MIN_LEVEL,
  CAT_BUTLER_MIN_COUNT,
} = require('../constants/achievements');
const { wilson95Bp } = require('../utils/stats');
const { buildPayload, hashPayload } = require('./achievementHash');

// ------------------------------------------------------------
//  순수 판정 함수 (DB 접근 없음 — 경계값 단위 테스트 대상)
// ------------------------------------------------------------

/**
 * ID 3/4 운 판정.
 *  입력: successes(성공수), total(시도수), expectedRateBp(기대 성공률 bp)
 *  반환: { skipped, achievementId: 3|4|null, ci, expectedRateBp }
 */
function judgeLuck({ successes, total, expectedRateBp }) {
  if (total < LUCK_MIN_ATTEMPTS) {
    return { skipped: true, achievementId: null, ci: null, expectedRateBp };
  }
  const ci = wilson95Bp(successes, total);
  let achievementId = null;
  if (ci.highBp < expectedRateBp) {
    achievementId = ACHIEVEMENT_IDS.CERTIFIED_SUCKER;   // 3: CI 전체가 기대 아래
  } else if (ci.lowBp > expectedRateBp) {
    achievementId = ACHIEVEMENT_IDS.HEAVENLY_LUCK;      // 4: CI 전체가 기대 위
  }
  return { skipped: false, achievementId, ci, expectedRateBp };
}

/** ID 5 다둥이 집사: 10강 이상 마리수 ≥ 5. */
function judgeCatButler({ count }) {
  return count >= CAT_BUTLER_MIN_COUNT;
}

// ------------------------------------------------------------
//  DB 래퍼 — 해당 유저만 검사 (db 는 주입: 테스트에서 fake 대체)
// ------------------------------------------------------------

/**
 * 감지된 업적을 'detected' 로 기록. 이미 존재(UNIQUE 충돌)하면 null.
 */
async function insertDetected(db, payload) {
  const dataHash = hashPayload(payload);
  const { rows } = await db.query(`
    INSERT INTO achievements (wallet, achievement_id, source, payload, data_hash, status)
    VALUES ($1, $2, 'offchain', $3, $4, 'detected')
    ON CONFLICT (wallet, achievement_id) DO NOTHING
    RETURNING id, wallet, achievement_id, source, payload, data_hash, status
  `, [payload.wallet, Number(payload.achievementId), JSON.stringify(payload), dataHash]);
  return rows[0] || null;
}

/**
 * 한 유저의 오프체인 업적(3/4/5) 일괄 검사 → 새로 감지된 행 배열 반환.
 *  (이미 발급·감지된 업적은 UNIQUE 충돌로 걸러져 반환에 포함되지 않는다)
 */
async function checkOffchainAchievements(db, wallet) {
  const detected = [];

  // ── ID 3/4: 완료된 base 시도 전체로 운 판정 ──────────────
  const { rows: [luck] } = await db.query(`
    SELECT COUNT(*)::int                                  AS total,
           COUNT(*) FILTER (WHERE success)::int           AS successes,
           COALESCE(SUM(claimed_success_rate), 0)::bigint AS sum_rate_bp,
           COALESCE(MIN(requested_block),
                    MIN(completed_block), 0)::bigint      AS from_block,
           COALESCE(MAX(completed_block), 0)::bigint      AS to_block
      FROM attempts
     WHERE user_address = $1
       AND status = 'completed'
       AND claimed_success_rate IS NOT NULL
  `, [wallet]);

  const expectedRateBp = luck.total > 0
    ? Math.round(Number(luck.sum_rate_bp) / luck.total)
    : 0;
  const verdict = judgeLuck({
    successes: luck.successes,
    total: luck.total,
    expectedRateBp,
  });

  if (verdict.achievementId !== null) {
    // evidence 의미 (ID 3/4): A=성공수, B=시도수
    const payload = buildPayload({
      wallet,
      achievementId: verdict.achievementId,
      evidenceA: luck.successes,
      evidenceB: luck.total,
      fromBlock: luck.from_block,
      toBlock: luck.to_block,
    });
    detected.push(await insertDetected(db, payload));
  }

  // ── ID 5: 다둥이 집사 ─────────────────────────────────────
  const { rows: [butler] } = await db.query(`
    SELECT COUNT(*)::int                       AS cnt,
           COALESCE(MAX(last_block), 0)::bigint AS to_block
      FROM user_items
     WHERE user_address = $1
       AND total_level >= $2
  `, [wallet, CAT_BUTLER_MIN_LEVEL]);

  if (judgeCatButler({ count: butler.cnt })) {
    // evidence 의미 (ID 5): A=10강 이상 마리수, B=0
    const payload = buildPayload({
      wallet,
      achievementId: ACHIEVEMENT_IDS.CAT_BUTLER,
      evidenceA: butler.cnt,
      evidenceB: 0,
      fromBlock: 0,
      toBlock: butler.to_block,
    });
    detected.push(await insertDetected(db, payload));
  }

  return detected.filter(Boolean);
}

module.exports = { judgeLuck, judgeCatButler, checkOffchainAchievements, insertDetected };

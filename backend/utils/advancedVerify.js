/**
 * ============================================================
 *  고급강화(상급) 결과 재검증 유틸 (★ 차별화 #2 의 고급강화판)
 * ============================================================
 *
 *  목적
 *  ----
 *  AdvancedEnhancementResult 이벤트(= advanced_attempts 한 행)만으로,
 *  컨트랙트 `AdvancedEnhancement.sol` 의 결과 산출 로직을 off-chain 에서
 *  그대로 재현해 "기록된 결과가 적용된 확률·난수와 모순 없는지" 검증한다.
 *  컨트랙트가 난수를 받고도 다른 결과를 기록했다면 즉시 탐지된다.
 *
 *  컨트랙트 산출 규칙 (AdvancedEnhancement.sol 과 1:1)
 *  --------------------------------------------------
 *   rollBps = randomValue % 10000           (보장 강화는 randomValue=0 → rollBps=0)
 *
 *   보장(Guaranteed): mode=Safe && beforeSafeDropStreak >= 2
 *     → resultType=Guaranteed(4), extra+1, streak=0, vrfRequestId=0
 *
 *   Safe 비보장 (_resolveSafeResult):
 *     roll < success           → Success(1),       extra+1,  streak=0
 *     else & beforeExtra > 0   → SafeDowngrade(2),  extra-1,  streak+1
 *     else (beforeExtra == 0)  → FailKeep(0),       extra=0,  streak=0   (5강 밑으론 안 떨어짐)
 *
 *   Risky (_resolveRiskyResult):
 *     roll < success                 → Success(1),  extra+1,  streak=0
 *     roll < success + destroy       → Destroyed(3), extra=0, streak=0
 *     else                           → FailKeep(0),  extra/streak 유지
 *
 *   totalLevel = 5(REQUIRED_BASE_LEVEL) + extraLevel
 * ============================================================
 */

'use strict';

const BP_DENOMINATOR = 10_000;
const SAFE_GUARANTEE_DROP_STREAK = 2;
const REQUIRED_BASE_LEVEL = 5;
const MAX_EXTRA_LEVEL = 5;

const MODE = { SAFE: 0, RISKY: 1 };

const RESULT_TYPE = {
  FailKeep: 0,
  Success: 1,
  SafeDowngrade: 2,
  Destroyed: 3,
  Guaranteed: 4,
};
const RESULT_LABEL = ['FailKeep', 'Success', 'SafeDowngrade', 'Destroyed', 'Guaranteed'];

const BP_DENOM_BIG = BigInt(BP_DENOMINATOR);

/** rollBps = randomValue % 10000 — 컨트랙트 fulfillRandomWords 와 동일. */
function computeRollBps(randomValue) {
  if (randomValue === null || randomValue === undefined) {
    throw new Error('computeRollBps: randomValue is null');
  }
  const rv = typeof randomValue === 'bigint' ? randomValue : BigInt(randomValue);
  return Number(((rv % BP_DENOM_BIG) + BP_DENOM_BIG) % BP_DENOM_BIG); // 0~9999
}

/** 보장 강화 여부 — 컨트랙트 request 단계 판정과 동일(mode=Safe && streak>=2). */
function isGuaranteed(mode, beforeSafeDropStreak) {
  return Number(mode) === MODE.SAFE && Number(beforeSafeDropStreak) >= SAFE_GUARANTEE_DROP_STREAK;
}

/**
 * 주어진 입력(mode, before 상태, roll, 적용된 확률밴드)으로
 * 컨트랙트가 내놨어야 할 (resultType, afterExtraLevel, afterSafeDropStreak) 를 재산출.
 */
function deriveExpected({ mode, beforeExtraLevel, beforeSafeDropStreak, rollBps, successRateBps, destroyRateBps, guaranteed }) {
  const m = Number(mode);
  const be = Number(beforeExtraLevel);
  const bs = Number(beforeSafeDropStreak);
  const roll = Number(rollBps);
  const success = Number(successRateBps);
  const destroy = Number(destroyRateBps);

  if (guaranteed) {
    return { resultType: RESULT_TYPE.Guaranteed, afterExtraLevel: be + 1, afterSafeDropStreak: 0 };
  }

  if (m === MODE.SAFE) {
    if (roll < success) return { resultType: RESULT_TYPE.Success, afterExtraLevel: be + 1, afterSafeDropStreak: 0 };
    if (be > 0) return { resultType: RESULT_TYPE.SafeDowngrade, afterExtraLevel: be - 1, afterSafeDropStreak: bs + 1 };
    return { resultType: RESULT_TYPE.FailKeep, afterExtraLevel: 0, afterSafeDropStreak: 0 };
  }

  // Risky
  if (roll < success) return { resultType: RESULT_TYPE.Success, afterExtraLevel: be + 1, afterSafeDropStreak: 0 };
  if (roll < success + destroy) return { resultType: RESULT_TYPE.Destroyed, afterExtraLevel: 0, afterSafeDropStreak: 0 };
  return { resultType: RESULT_TYPE.FailKeep, afterExtraLevel: be, afterSafeDropStreak: bs };
}

/**
 * advanced_attempts 한 행(완료된 시도)을 검증.
 *
 *  input (camelCase, fromDbRow 로 변환):
 *   { mode, beforeExtraLevel, afterExtraLevel, beforeTotalLevel, afterTotalLevel,
 *     resultType, beforeSafeDropStreak, afterSafeDropStreak, guaranteed,
 *     successRateBps, destroyRateBps, randomValue, rollBps, vrfRequestId? }
 *
 *  반환:
 *   { ok, expected, actual, checks, mismatches }
 */
function verifyAdvancedAttempt(input) {
  const mode = Number(input.mode);
  const beforeExtraLevel = Number(input.beforeExtraLevel);
  const beforeSafeDropStreak = Number(input.beforeSafeDropStreak);
  const successRateBps = Number(input.successRateBps);
  const destroyRateBps = Number(input.destroyRateBps);
  const rollBps = Number(input.rollBps);

  // 올바른 경로(보장 여부)는 입력 상태에서 재판정한다.
  const expectedGuaranteed = isGuaranteed(mode, beforeSafeDropStreak);
  const expectedRollBps = expectedGuaranteed ? 0 : computeRollBps(input.randomValue);

  const expected = deriveExpected({
    mode, beforeExtraLevel, beforeSafeDropStreak,
    rollBps: expectedRollBps, successRateBps, destroyRateBps,
    guaranteed: expectedGuaranteed,
  });

  const checks = {
    // 1) 보장 플래그가 (mode,streak) 로 재판정한 값과 일치
    guaranteedConsistent: Boolean(input.guaranteed) === expectedGuaranteed,
    // 2) rollBps == randomValue % 10000 (보장이면 0)
    rollMatches: rollBps === expectedRollBps,
    // 3) 결과종류 일치
    resultTypeMatch: Number(input.resultType) === expected.resultType,
    // 4) after extraLevel 전이 일치
    afterExtraLevelMatch: Number(input.afterExtraLevel) === expected.afterExtraLevel,
    // 5) after safeDropStreak 전이 일치
    afterStreakMatch: Number(input.afterSafeDropStreak) === expected.afterSafeDropStreak,
    // 6) totalLevel = 5 + extraLevel (before/after 모두)
    totalLevelConsistent:
      Number(input.beforeTotalLevel) === REQUIRED_BASE_LEVEL + beforeExtraLevel &&
      Number(input.afterTotalLevel) === REQUIRED_BASE_LEVEL + expected.afterExtraLevel,
    // 7) 적용된 확률밴드 정합 (합 <= 10000, Safe 는 파괴율 0, 성공률 > 0)
    rateValid:
      successRateBps > 0 &&
      successRateBps + destroyRateBps <= BP_DENOMINATOR &&
      (mode !== MODE.SAFE || destroyRateBps === 0),
  };

  // vrfRequestId 가 주어지면: 보장이면 0, 아니면 0이 아니어야 함
  if (input.vrfRequestId !== undefined && input.vrfRequestId !== null) {
    const vrfZero = BigInt(input.vrfRequestId) === 0n;
    checks.vrfConsistent = expectedGuaranteed ? vrfZero : !vrfZero;
  }

  const mismatches = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
  const ok = mismatches.length === 0;

  return {
    ok,
    expected: {
      resultType: expected.resultType,
      resultLabel: RESULT_LABEL[expected.resultType],
      afterExtraLevel: expected.afterExtraLevel,
      afterSafeDropStreak: expected.afterSafeDropStreak,
      guaranteed: expectedGuaranteed,
      rollBps: expectedRollBps,
    },
    actual: {
      resultType: Number(input.resultType),
      resultLabel: RESULT_LABEL[Number(input.resultType)] || null,
      afterExtraLevel: Number(input.afterExtraLevel),
      afterSafeDropStreak: Number(input.afterSafeDropStreak),
      guaranteed: Boolean(input.guaranteed),
      rollBps,
    },
    checks,
    mismatches,
  };
}

/** advanced_attempts DB 행(snake_case) → verifyAdvancedAttempt 입력(camelCase). */
function fromDbRow(row) {
  return {
    attemptId: row.attempt_id,
    mode: row.mode,
    beforeExtraLevel: row.before_extra_level,
    afterExtraLevel: row.after_extra_level,
    beforeTotalLevel: row.before_total_level,
    afterTotalLevel: row.after_total_level,
    resultType: row.result_type,
    beforeSafeDropStreak: row.before_safe_drop_streak,
    afterSafeDropStreak: row.after_safe_drop_streak,
    guaranteed: row.guaranteed,
    successRateBps: row.success_rate_bps,
    destroyRateBps: row.destroy_rate_bps,
    randomValue: row.random_value,
    rollBps: row.roll_bps,
    vrfRequestId: row.vrf_request_id,
  };
}

module.exports = {
  // 상수
  BP_DENOMINATOR,
  SAFE_GUARANTEE_DROP_STREAK,
  REQUIRED_BASE_LEVEL,
  MAX_EXTRA_LEVEL,
  MODE,
  RESULT_TYPE,
  RESULT_LABEL,
  // 함수
  computeRollBps,
  isGuaranteed,
  deriveExpected,
  verifyAdvancedAttempt,
  fromDbRow,
};

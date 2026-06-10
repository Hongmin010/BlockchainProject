/**
 * ============================================================
 *  utils/advancedVerify.js 단위 테스트 — node:test
 *  실행: npm test
 * ============================================================
 *  컨트랙트 AdvancedEnhancement.sol 산출 로직 재현 정확성 +
 *  조작(거짓 결과) 탐지 능력을 네트워크/DB 없이 검증.
 * ============================================================
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  computeRollBps, isGuaranteed, deriveExpected, verifyAdvancedAttempt, fromDbRow,
  RESULT_TYPE, MODE,
} = require('./advancedVerify');

// ------------------------------------------------------------
//  헬퍼: 정상 시도 행 (필요한 필드만 override)
// ------------------------------------------------------------
function attempt(over = {}) {
  return {
    mode: 0,
    beforeExtraLevel: 1,
    afterExtraLevel: 2,
    beforeTotalLevel: 6,
    afterTotalLevel: 7,
    resultType: RESULT_TYPE.Success,
    beforeSafeDropStreak: 0,
    afterSafeDropStreak: 0,
    guaranteed: false,
    successRateBps: 2500,
    destroyRateBps: 0,
    randomValue: '1000',
    rollBps: 1000,
    vrfRequestId: '777',
    ...over,
  };
}


// ------------------------------------------------------------
//  computeRollBps / isGuaranteed
// ------------------------------------------------------------
test('computeRollBps: randomValue % 10000', () => {
  assert.equal(computeRollBps('123456789'), 6789);
  assert.equal(computeRollBps(0), 0);
  assert.equal(computeRollBps(9999n), 9999);
  assert.equal(computeRollBps('10000'), 0);
});

test('computeRollBps: null → throw', () => {
  assert.throws(() => computeRollBps(null));
});

test('isGuaranteed: Safe & streak>=2 만 true', () => {
  assert.equal(isGuaranteed(MODE.SAFE, 2), true);
  assert.equal(isGuaranteed(MODE.SAFE, 1), false);
  assert.equal(isGuaranteed(MODE.RISKY, 5), false); // Risky 는 보장 없음
});


// ------------------------------------------------------------
//  정상 산출 — Safe
// ------------------------------------------------------------
test('Safe 성공: roll<success → Success, extra+1, streak=0', () => {
  const r = verifyAdvancedAttempt(attempt({ successRateBps: 2500, randomValue: '1000', rollBps: 1000 }));
  assert.equal(r.ok, true, JSON.stringify(r.mismatches));
  assert.equal(r.expected.resultType, RESULT_TYPE.Success);
});

test('Safe 하락: roll>=success & extra>0 → SafeDowngrade, extra-1, streak+1', () => {
  const r = verifyAdvancedAttempt(attempt({
    beforeExtraLevel: 2, beforeTotalLevel: 7, beforeSafeDropStreak: 1,
    successRateBps: 2000, randomValue: '5000', rollBps: 5000,
    resultType: RESULT_TYPE.SafeDowngrade, afterExtraLevel: 1, afterTotalLevel: 6, afterSafeDropStreak: 2,
  }));
  assert.equal(r.ok, true, JSON.stringify(r.mismatches));
});

test('Safe 유지(extra=0): roll>=success → FailKeep, extra=0, streak=0', () => {
  const r = verifyAdvancedAttempt(attempt({
    beforeExtraLevel: 0, beforeTotalLevel: 5, beforeSafeDropStreak: 0,
    successRateBps: 3000, randomValue: '5000', rollBps: 5000,
    resultType: RESULT_TYPE.FailKeep, afterExtraLevel: 0, afterTotalLevel: 5, afterSafeDropStreak: 0,
  }));
  assert.equal(r.ok, true, JSON.stringify(r.mismatches));
});


// ------------------------------------------------------------
//  정상 산출 — Risky
// ------------------------------------------------------------
test('Risky 성공: roll<success → Success, extra+1', () => {
  const r = verifyAdvancedAttempt(attempt({
    mode: 1, beforeExtraLevel: 0, beforeTotalLevel: 5,
    successRateBps: 4500, destroyRateBps: 500, randomValue: '1000', rollBps: 1000,
    resultType: RESULT_TYPE.Success, afterExtraLevel: 1, afterTotalLevel: 6, afterSafeDropStreak: 0,
  }));
  assert.equal(r.ok, true, JSON.stringify(r.mismatches));
});

test('Risky 파괴: success<=roll<success+destroy → Destroyed, extra=0', () => {
  const r = verifyAdvancedAttempt(attempt({
    mode: 1, beforeExtraLevel: 3, beforeTotalLevel: 8,
    successRateBps: 3000, destroyRateBps: 2000, randomValue: '4000', rollBps: 4000,
    resultType: RESULT_TYPE.Destroyed, afterExtraLevel: 0, afterTotalLevel: 5, afterSafeDropStreak: 0,
  }));
  assert.equal(r.ok, true, JSON.stringify(r.mismatches));
});

test('Risky 유지: roll>=success+destroy → FailKeep, extra/streak 유지', () => {
  const r = verifyAdvancedAttempt(attempt({
    mode: 1, beforeExtraLevel: 3, beforeTotalLevel: 8, beforeSafeDropStreak: 1,
    successRateBps: 3000, destroyRateBps: 2000, randomValue: '7000', rollBps: 7000,
    resultType: RESULT_TYPE.FailKeep, afterExtraLevel: 3, afterTotalLevel: 8, afterSafeDropStreak: 1,
  }));
  assert.equal(r.ok, true, JSON.stringify(r.mismatches));
});


// ------------------------------------------------------------
//  정상 산출 — 보장(Guaranteed)
// ------------------------------------------------------------
test('보장: Safe & streak>=2 → Guaranteed, extra+1, streak=0, roll/random/vrf=0', () => {
  const r = verifyAdvancedAttempt(attempt({
    mode: 0, beforeExtraLevel: 1, beforeTotalLevel: 6, beforeSafeDropStreak: 2,
    successRateBps: 2500, destroyRateBps: 0, randomValue: '0', rollBps: 0,
    guaranteed: true, vrfRequestId: '0',
    resultType: RESULT_TYPE.Guaranteed, afterExtraLevel: 2, afterTotalLevel: 7, afterSafeDropStreak: 0,
  }));
  assert.equal(r.ok, true, JSON.stringify(r.mismatches));
  assert.equal(r.expected.guaranteed, true);
});


// ------------------------------------------------------------
//  조작 탐지 (negative)
// ------------------------------------------------------------
test('탐지: 거짓 resultType (실제 유지인데 성공 기록) → ok=false', () => {
  const r = verifyAdvancedAttempt(attempt({
    mode: 1, beforeExtraLevel: 3, beforeTotalLevel: 8,
    successRateBps: 3000, destroyRateBps: 2000, randomValue: '7000', rollBps: 7000,
    resultType: RESULT_TYPE.Success, afterExtraLevel: 4, afterTotalLevel: 9, // 거짓
  }));
  assert.equal(r.ok, false);
  assert.equal(r.checks.resultTypeMatch, false);
});

test('탐지: 보장 플래그 불일치 (streak<2인데 guaranteed=true)', () => {
  const r = verifyAdvancedAttempt(attempt({
    mode: 0, beforeSafeDropStreak: 0, guaranteed: true,
  }));
  assert.equal(r.checks.guaranteedConsistent, false);
  assert.equal(r.ok, false);
});

test('탐지: Safe 인데 파괴율>0 → rateValid=false', () => {
  const r = verifyAdvancedAttempt(attempt({ mode: 0, destroyRateBps: 500 }));
  assert.equal(r.checks.rateValid, false);
});

test('탐지: rollBps 가 randomValue%10000 과 불일치', () => {
  const r = verifyAdvancedAttempt(attempt({ randomValue: '1000', rollBps: 2222 }));
  assert.equal(r.checks.rollMatches, false);
  assert.equal(r.ok, false);
});

test('탐지: totalLevel != 5 + extraLevel', () => {
  const r = verifyAdvancedAttempt(attempt({ beforeTotalLevel: 99 }));
  assert.equal(r.checks.totalLevelConsistent, false);
});

test('탐지: 비보장인데 vrfRequestId=0', () => {
  const r = verifyAdvancedAttempt(attempt({ guaranteed: false, vrfRequestId: '0' }));
  assert.equal(r.checks.vrfConsistent, false);
});


// ------------------------------------------------------------
//  deriveExpected / fromDbRow
// ------------------------------------------------------------
test('deriveExpected: 경계 roll==success → 실패측(Safe 하락)', () => {
  const e = deriveExpected({ mode: 0, beforeExtraLevel: 1, beforeSafeDropStreak: 0, rollBps: 2500, successRateBps: 2500, destroyRateBps: 0, guaranteed: false });
  assert.equal(e.resultType, RESULT_TYPE.SafeDowngrade); // roll < success 가 아니므로 실패
});

test('fromDbRow: snake_case → camelCase 매핑', () => {
  const row = {
    attempt_id: '5', mode: 1, before_extra_level: 0, after_extra_level: 1,
    before_total_level: 5, after_total_level: 6, result_type: 1,
    before_safe_drop_streak: 0, after_safe_drop_streak: 0, guaranteed: false,
    success_rate_bps: 4500, destroy_rate_bps: 500, random_value: '1000', roll_bps: 1000, vrf_request_id: '9',
  };
  const r = verifyAdvancedAttempt(fromDbRow(row));
  assert.equal(r.ok, true, JSON.stringify(r.mismatches));
});

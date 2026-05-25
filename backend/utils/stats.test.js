/**
 * ============================================================
 *  utils/stats.js 단위 테스트 — node:test (Node 18+ 내장)
 *  실행: npm test
 * ============================================================
 *
 *  채택 이유: 외부 의존성 0 (jest/mocha 미설치). Node v20+ 가 기본 환경이고
 *  SETUP.md 도 node --watch 를 가정하므로 일관성 있는 선택.
 *
 *  알려진 케이스 (Wilson, 카이제곱) 의 참값은 R 또는 SciPy 결과를 기준으로
 *  3~4자리 오차 허용. 본 모듈은 발표 데모용 통계 표시 정밀도이므로 충분.
 * ============================================================
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  bpToRate,
  rateToBp,
  wilson95,
  wilson95Bp,
  chiSquare1df,
  erfc,
  fairnessVerdict,
  summarizeLevel,
} = require('./stats');


// ------------------------------------------------------------
//  bp <-> rate 변환
// ------------------------------------------------------------
test('bpToRate: 5000bp = 0.5', () => {
  assert.equal(bpToRate(5000), 0.5);
});

test('rateToBp: bp 라운드트립이 정확', () => {
  for (const bp of [0, 1, 1234, 5000, 9999, 10_000]) {
    assert.equal(rateToBp(bpToRate(bp)), bp);
  }
});

test('rateToBp: 음수/오버플로 클램프', () => {
  assert.equal(rateToBp(-0.5), 0);
  assert.equal(rateToBp(1.5), 10_000);
});


// ------------------------------------------------------------
//  Wilson 95% CI
// ------------------------------------------------------------
test('wilson95: n=0 이면 가장 넓은 구간 [0,1]', () => {
  const ci = wilson95(0, 0);
  assert.equal(ci.low, 0);
  assert.equal(ci.high, 1);
});

test('wilson95: 5/10 ≈ (0.2366, 0.7634)', () => {
  // R: prop.test(5,10,correct=FALSE)$conf.int
  const ci = wilson95(5, 10);
  assert.ok(Math.abs(ci.low - 0.2366) < 1e-3, `low=${ci.low}`);
  assert.ok(Math.abs(ci.high - 0.7634) < 1e-3, `high=${ci.high}`);
});

test('wilson95: 50/100 ≈ (0.4038, 0.5962)', () => {
  const ci = wilson95(50, 100);
  assert.ok(Math.abs(ci.low - 0.4038) < 1e-3, `low=${ci.low}`);
  assert.ok(Math.abs(ci.high - 0.5962) < 1e-3, `high=${ci.high}`);
});

test('wilson95: 0/100 → low≈0, high 작음', () => {
  const ci = wilson95(0, 100);
  // 부동소수점 오차 허용 (이론값 0, 실제 ~1e-18 가능)
  assert.ok(ci.low < 1e-10, `low=${ci.low}`);
  assert.ok(ci.high > 0 && ci.high < 0.05, `high=${ci.high}`);
});

test('wilson95: 100/100 → high≈1, low 큼', () => {
  const ci = wilson95(100, 100);
  assert.ok(ci.high > 1 - 1e-10, `high=${ci.high}`);
  assert.ok(ci.low > 0.95 && ci.low < 1, `low=${ci.low}`);
});

test('wilson95: 잘못된 입력은 RangeError', () => {
  assert.throws(() => wilson95(11, 10), RangeError);
  assert.throws(() => wilson95(-1, 10), RangeError);
});

test('wilson95Bp: bp 정수 + 점 추정 포함', () => {
  const { lowBp, highBp } = wilson95Bp(50, 100);
  assert.ok(Number.isInteger(lowBp));
  assert.ok(Number.isInteger(highBp));
  assert.ok(lowBp <= 5000 && highBp >= 5000, `[${lowBp}, ${highBp}]`);
});


// ------------------------------------------------------------
//  erfc
// ------------------------------------------------------------
test('erfc(0) ≈ 1', () => {
  assert.ok(Math.abs(erfc(0) - 1) < 1e-6);
});

test('erfc(1) ≈ 0.1573', () => {
  assert.ok(Math.abs(erfc(1) - 0.1573) < 1e-4);
});

test('erfc(-1) ≈ 1.8427  (대칭성)', () => {
  assert.ok(Math.abs(erfc(-1) - 1.8427) < 1e-4);
});

test('erfc(2) ≈ 0.00468', () => {
  assert.ok(Math.abs(erfc(2) - 0.00468) < 1e-4);
});


// ------------------------------------------------------------
//  카이제곱 (1df)
// ------------------------------------------------------------
test('chiSquare1df: 완벽 일치 → stat≈0, p≈1', () => {
  const { stat, pValue } = chiSquare1df(50, 100, 0.5);
  assert.ok(stat < 1e-9, `stat=${stat}`);
  assert.ok(Math.abs(pValue - 1) < 1e-6, `p=${pValue}`);
});

test('chiSquare1df: 표기 50% vs 실측 30/100 → χ²=16, p<1e-3', () => {
  // E = (50, 50), O = (30, 70) → χ² = (20²/50) + (20²/50) = 16
  const { stat, pValue } = chiSquare1df(30, 100, 0.5);
  assert.ok(Math.abs(stat - 16) < 1e-9, `stat=${stat}`);
  assert.ok(pValue < 1e-3, `p=${pValue}`);
});

test('chiSquare1df: n=0 → 검정 불가, p=1', () => {
  const r = chiSquare1df(0, 0, 0.5);
  assert.equal(r.stat, 0);
  assert.equal(r.pValue, 1);
});

test('chiSquare1df: declared=0 + 모두 실패 → p=1', () => {
  const r = chiSquare1df(0, 100, 0);
  assert.equal(r.pValue, 1);
});

test('chiSquare1df: declared=0 + 한 건이라도 성공 → p=0', () => {
  const r = chiSquare1df(1, 100, 0);
  assert.equal(r.pValue, 0);
});

test('chiSquare1df: declared=1 + 모두 성공 → p=1', () => {
  const r = chiSquare1df(100, 100, 1);
  assert.equal(r.pValue, 1);
});


// ------------------------------------------------------------
//  fairnessVerdict
// ------------------------------------------------------------
test('fairnessVerdict: total<30 → insufficient_data', () => {
  assert.equal(fairnessVerdict(29, 0.001), 'insufficient_data');
  assert.equal(fairnessVerdict(0, 1), 'insufficient_data');
});

test('fairnessVerdict: total≥30 + p<0.01 → suspicious', () => {
  assert.equal(fairnessVerdict(30, 0.0099), 'suspicious');
  assert.equal(fairnessVerdict(1000, 1e-10), 'suspicious');
});

test('fairnessVerdict: total≥30 + p≥0.01 → plausible', () => {
  assert.equal(fairnessVerdict(30, 0.01), 'plausible');
  assert.equal(fairnessVerdict(1000, 0.5), 'plausible');
});


// ------------------------------------------------------------
//  summarizeLevel — 라우트 어댑터
// ------------------------------------------------------------
test('summarizeLevel: 표기 50%, 실측 412/823 → plausible', () => {
  const out = summarizeLevel({
    beforeLevel: 7, declaredBp: 5000, hits: 412, total: 823,
  });
  assert.equal(out.beforeLevel, 7);
  assert.equal(out.declaredRateBp, 5000);
  assert.equal(out.observedSuccess, 412);
  assert.equal(out.observedTotal, 823);
  assert.ok(Math.abs(out.observedRateBp - 5006) <= 1, `bp=${out.observedRateBp}`);
  assert.ok(out.wilson95.lowBp < 5000 && out.wilson95.highBp > 5000);
  assert.ok(out.chiSquare.pValue > 0.5);   // 거의 일치
  assert.equal(out.fairnessVerdict, 'plausible');
});

test('summarizeLevel: 표기 50%, 실측 30/100 → suspicious', () => {
  const out = summarizeLevel({
    beforeLevel: 4, declaredBp: 5000, hits: 30, total: 100,
  });
  assert.equal(out.observedRateBp, 3000);
  assert.equal(out.fairnessVerdict, 'suspicious');
});

test('summarizeLevel: 표기 50%, 실측 5/10 → insufficient_data', () => {
  const out = summarizeLevel({
    beforeLevel: 1, declaredBp: 5000, hits: 5, total: 10,
  });
  assert.equal(out.fairnessVerdict, 'insufficient_data');
});

test('summarizeLevel: total=0 → observedRateBp=0, insufficient_data', () => {
  const out = summarizeLevel({
    beforeLevel: 0, declaredBp: 9000, hits: 0, total: 0,
  });
  assert.equal(out.observedRateBp, 0);
  assert.equal(out.observedSuccess, 0);
  assert.equal(out.observedTotal, 0);
  assert.equal(out.fairnessVerdict, 'insufficient_data');
});

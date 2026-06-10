/**
 * ============================================================
 *  utils/advancedStats.js + stats.js(다항 검정) 단위 테스트 — node:test
 *  실행: npm test
 * ============================================================
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { chiSquareSf, chiSquareGof } = require('./stats');
const { summarizeAdvancedSafe, summarizeAdvancedRisky } = require('./advancedStats');

const approx = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);


// ------------------------------------------------------------
//  chiSquareSf
// ------------------------------------------------------------
test('chiSquareSf: stat<=0 → p=1', () => {
  assert.equal(chiSquareSf(0, 1), 1);
  assert.equal(chiSquareSf(0, 2), 1);
});

test('chiSquareSf: df=2 → exp(-stat/2)', () => {
  approx(chiSquareSf(2, 2), Math.exp(-1));
  approx(chiSquareSf(6, 2), Math.exp(-3));
});

test('chiSquareSf: 지원 안 하는 df → throw', () => {
  assert.throws(() => chiSquareSf(3, 3));
});


// ------------------------------------------------------------
//  chiSquareGof (다항 적합도, df=k-1)
// ------------------------------------------------------------
test('chiSquareGof: 완벽 적합 → stat≈0, p≈1, df=2', () => {
  const r = chiSquareGof([45, 5, 50], [0.45, 0.05, 0.50]);
  approx(r.stat, 0);
  approx(r.pValue, 1);
  assert.equal(r.df, 2);
  assert.equal(r.n, 100);
});

test('chiSquareGof: 큰 편차 → stat=50, p<1e-3', () => {
  // E=[45,5,50], O=[30,20,50] → 225/45 + 225/5 + 0 = 50
  const r = chiSquareGof([30, 20, 50], [0.45, 0.05, 0.50]);
  approx(r.stat, 50, 1e-9);
  assert.ok(r.pValue < 1e-3);
});

test('chiSquareGof: n=0 → p=1', () => {
  const r = chiSquareGof([0, 0, 0], [0.45, 0.05, 0.50]);
  assert.equal(r.pValue, 1);
  assert.equal(r.n, 0);
});

test('chiSquareGof: 확률 0 범주에 관측 발생 → p=0', () => {
  const r = chiSquareGof([10, 3, 10], [0.5, 0, 0.5]);
  assert.equal(r.pValue, 0);
});

test('chiSquareGof: 길이 불일치 → throw', () => {
  assert.throws(() => chiSquareGof([1, 2], [0.5, 0.3, 0.2]));
});


// ------------------------------------------------------------
//  summarizeAdvancedSafe (이항)
// ------------------------------------------------------------
test('Safe 요약: 표기 30% vs 실측 30/100 → plausible', () => {
  const s = summarizeAdvancedSafe({ extraLevel: 0, declaredSuccessBp: 3000, success: 30, total: 100 });
  assert.equal(s.mode, 'safe');
  assert.equal(s.observedSuccessRateBp, 3000);
  assert.equal(s.fairnessVerdict, 'plausible');
});

test('Safe 요약: 표기 30% vs 실측 60/100 → suspicious', () => {
  const s = summarizeAdvancedSafe({ extraLevel: 0, declaredSuccessBp: 3000, success: 60, total: 100 });
  assert.ok(s.chiSquare.pValue < 0.01);
  assert.equal(s.fairnessVerdict, 'suspicious');
});

test('Safe 요약: total<30 → insufficient_data', () => {
  const s = summarizeAdvancedSafe({ extraLevel: 4, declaredSuccessBp: 1000, success: 1, total: 10 });
  assert.equal(s.fairnessVerdict, 'insufficient_data');
});


// ------------------------------------------------------------
//  summarizeAdvancedRisky (다항)
// ------------------------------------------------------------
test('Risky 요약: 표기 45/5 vs 실측 45/5/50 → plausible, df=2, keep=5000bp', () => {
  const s = summarizeAdvancedRisky({
    extraLevel: 0, declaredSuccessBp: 4500, declaredDestroyBp: 500,
    success: 45, destroyed: 5, failKeep: 50, total: 100,
  });
  assert.equal(s.mode, 'risky');
  assert.equal(s.declaredKeepRateBp, 5000);
  assert.equal(s.chiSquare.df, 2);
  assert.equal(s.fairnessVerdict, 'plausible');
  assert.equal(s.observedDestroyRateBp, 500);
});

test('Risky 요약: 파괴율 급증(실측 20%) → suspicious', () => {
  const s = summarizeAdvancedRisky({
    extraLevel: 0, declaredSuccessBp: 4500, declaredDestroyBp: 500,
    success: 30, destroyed: 20, failKeep: 50, total: 100,
  });
  assert.ok(s.chiSquare.pValue < 0.01);
  assert.equal(s.fairnessVerdict, 'suspicious');
});

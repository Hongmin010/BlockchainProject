/**
 * utils/verify.js 단위 테스트 (node:test)
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { verifySuccess, normalizeAddress } = require('./verify');


// ------------------------------------------------------------
//  verifySuccess
// ------------------------------------------------------------
test('verifySuccess: roll < rate → true', () => {
  // 12345 % 10000 = 2345, < 5000 → success
  assert.equal(verifySuccess('12345', 5000), true);
});

test('verifySuccess: roll >= rate → false', () => {
  // 12345 % 10000 = 2345, >= 2000 → fail
  assert.equal(verifySuccess('12345', 2000), false);
});

test('verifySuccess: rate=0 → 항상 실패', () => {
  assert.equal(verifySuccess('0', 0), false);
  assert.equal(verifySuccess('1', 0), false);
  assert.equal(verifySuccess('99999', 0), false);
});

test('verifySuccess: rate=10000 → 항상 성공', () => {
  assert.equal(verifySuccess('0', 10000), true);
  assert.equal(verifySuccess('9999', 10000), true);
});

test('verifySuccess: BigInt 입력 허용', () => {
  assert.equal(verifySuccess(12345n, 5000), true);
});

test('verifySuccess: 매우 큰 uint256 처리', () => {
  // 2^256-1 의 마지막 4자리 mod 10000
  const max = 2n ** 256n - 1n;
  const roll = Number(max % 10000n);
  assert.equal(verifySuccess(max, roll + 1), true);
  assert.equal(verifySuccess(max, roll), false);
});

test('verifySuccess: 경계 — roll == rate 면 fail', () => {
  // 25000 % 10000 = 5000, == 5000 → false (strict <)
  assert.equal(verifySuccess('25000', 5000), false);
});

test('verifySuccess: null/undefined → throw', () => {
  assert.throws(() => verifySuccess(null, 5000));
  assert.throws(() => verifySuccess(undefined, 5000));
});

test('verifySuccess: bp 범위 밖 → RangeError', () => {
  assert.throws(() => verifySuccess('1', -1), RangeError);
  assert.throws(() => verifySuccess('1', 10001), RangeError);
  assert.throws(() => verifySuccess('1', 1.5), RangeError);
});


// ------------------------------------------------------------
//  normalizeAddress
// ------------------------------------------------------------
test('normalizeAddress: 유효 주소 → lowercase', () => {
  assert.equal(
    normalizeAddress('0xABCDEF0123456789abcdef0123456789ABCDEF01'),
    '0xabcdef0123456789abcdef0123456789abcdef01',
  );
});

test('normalizeAddress: 이미 lowercase면 그대로', () => {
  const addr = '0xabcdef0123456789abcdef0123456789abcdef01';
  assert.equal(normalizeAddress(addr), addr);
});

test('normalizeAddress: 길이 부족/초과 → null', () => {
  assert.equal(normalizeAddress('0x123'), null);
  assert.equal(normalizeAddress('0x' + 'a'.repeat(41)), null);
});

test('normalizeAddress: 0x prefix 없음 → null', () => {
  assert.equal(normalizeAddress('abcdef0123456789abcdef0123456789abcdef01'), null);
});

test('normalizeAddress: 비-hex 문자 → null', () => {
  assert.equal(normalizeAddress('0xZZZZZZ0123456789abcdef0123456789abcdef01'), null);
});

test('normalizeAddress: 비-문자열 → null', () => {
  assert.equal(normalizeAddress(null), null);
  assert.equal(normalizeAddress(undefined), null);
  assert.equal(normalizeAddress(123), null);
  assert.equal(normalizeAddress({}), null);
});

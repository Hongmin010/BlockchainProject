/**
 * lib/achievementHash.js 단위 테스트
 *  - 스냅샷: 고정 입력의 dataHash 가 docs/hash-test-vector.md 와 동일해야 한다.
 *    (인코딩 스펙이 바뀌면 컨트랙트와 어긋난다 — 이 테스트가 깨지면
 *     scripts/printHashTestVector.js 재실행 + 컨트랙트팀 재합의 필요)
 */

const { test } = require('node:test');
const assert = require('node:assert');

const { buildPayload, encodePayload, hashPayload } = require('./achievementHash');
const { ACHIEVEMENT_PAYLOAD_TYPES } = require('../constants/achievements');

// scripts/printHashTestVector.js 의 FIXED_INPUT 과 동일 세트 (변경 금지)
const FIXED_INPUT = {
  wallet: '0xAbcDef0123456789abCdef0123456789ABCDEF01',
  achievementId: 4,
  evidenceA: 31,
  evidenceB: 40,
  fromBlock: 26000000,
  toBlock: 26123456,
};
const EXPECTED_HASH = '0xeb63454cd7ffa48cf0e34c4d2a0d97a414c5f9b774827f2d55979a464a4dcafc';

test('스냅샷: 고정 입력 → 테스트 벡터 해시와 일치', () => {
  assert.strictEqual(hashPayload(FIXED_INPUT), EXPECTED_HASH);
});

test('스냅샷: 타입·순서 배열이 합의 스펙 그대로', () => {
  assert.deepStrictEqual(
    [...ACHIEVEMENT_PAYLOAD_TYPES],
    ['address', 'uint256', 'uint256', 'uint256', 'uint256', 'uint256'],
  );
});

test('abi.encode 는 6 슬롯 × 32 bytes = 192 bytes (정적 레이아웃)', () => {
  const encoded = encodePayload(FIXED_INPUT);
  assert.strictEqual((encoded.length - 2) / 2, 192);
});

test('buildPayload: wallet 소문자 정규화 + 나머지는 10진수 문자열', () => {
  const p = buildPayload(FIXED_INPUT);
  assert.strictEqual(p.wallet, '0xabcdef0123456789abcdef0123456789abcdef01');
  assert.deepStrictEqual(
    [p.achievementId, p.evidenceA, p.evidenceB, p.fromBlock, p.toBlock],
    ['4', '31', '40', '26000000', '26123456'],
  );
});

test('멱등성: buildPayload 결과를 다시 해시해도 동일', () => {
  assert.strictEqual(hashPayload(buildPayload(FIXED_INPUT)), EXPECTED_HASH);
});

test('입력 표현이 달라도 (string/bigint) 같은 해시', () => {
  assert.strictEqual(
    hashPayload({
      wallet: '0xabcdef0123456789abcdef0123456789abcdef01',
      achievementId: '4', evidenceA: 31n, evidenceB: '40',
      fromBlock: 26000000n, toBlock: '26123456',
    }),
    EXPECTED_HASH,
  );
});

test('잘못된 주소 → TypeError', () => {
  assert.throws(() => buildPayload({ ...FIXED_INPUT, wallet: '0x1234' }), TypeError);
  assert.throws(() => buildPayload({ ...FIXED_INPUT, wallet: null }), TypeError);
});

test('uint256 범위 밖 / 변환 불가 → throw', () => {
  assert.throws(() => buildPayload({ ...FIXED_INPUT, evidenceA: -1 }), RangeError);
  assert.throws(() => buildPayload({ ...FIXED_INPUT, evidenceA: 2n ** 256n }), RangeError);
  assert.throws(() => buildPayload({ ...FIXED_INPUT, evidenceB: 'abc' }), TypeError);
  assert.throws(() => buildPayload({ ...FIXED_INPUT, fromBlock: undefined }), TypeError);
});

test('필드 값이 다르면 해시도 달라진다 (필드별 민감도)', () => {
  for (const key of ['achievementId', 'evidenceA', 'evidenceB', 'fromBlock', 'toBlock']) {
    const mutated = { ...FIXED_INPUT, [key]: Number(FIXED_INPUT[key]) + 1 };
    assert.notStrictEqual(hashPayload(mutated), EXPECTED_HASH, `${key} 변경이 해시에 반영 안 됨`);
  }
  const otherWallet = { ...FIXED_INPUT, wallet: '0xabcdef0123456789abcdef0123456789abcdef02' };
  assert.notStrictEqual(hashPayload(otherWallet), EXPECTED_HASH);
});

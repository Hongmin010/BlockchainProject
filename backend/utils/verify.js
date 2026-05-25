/**
 * ============================================================
 *  VRF 재검증 + 주소 정규화 유틸 (★ 차별화 포인트 #2)
 * ============================================================
 *
 *  - verifySuccess: 컨트랙트의 결과 산출 공식 `(randomValue % 10000) < successRate`
 *    를 off-chain 에서 재현한다. EnhancementCompleted.randomValue 와
 *    claimedSuccessRate(bp) 만 있으면 누구나 재계산 가능 — 컨트랙트가 난수를 받고도
 *    다른 결과를 기록했다면 즉시 탐지됨.
 *
 *    ⚠ 본 공식은 events.md v2.0 명세 기준. 본구현 합의 단계에서 컨트랙트 팀과
 *    최종 공식(예: 임계값, 분모 변경) 동일성 재확인 필요.
 *
 *  - normalizeAddress: API 입력 경로(`/api/stats/user/:address`)와
 *    DB 저장(lowercase 정규화)을 통일.
 * ============================================================
 */

'use strict';

const { BP_DENOMINATOR } = require('./stats');

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const BP_DENOM_BIG = BigInt(BP_DENOMINATOR);

/**
 * randomValueStr      : NUMERIC(78,0) 컬럼에서 온 문자열 (또는 BigInt)
 * claimedSuccessBp    : INTEGER (0~10000)
 * 반환                : boolean — 컨트랙트가 emit 한 success 와 일치해야 정상
 */
function verifySuccess(randomValueStr, claimedSuccessBp) {
  if (randomValueStr === null || randomValueStr === undefined) {
    throw new Error('verifySuccess: randomValue is null');
  }
  if (!Number.isInteger(claimedSuccessBp) || claimedSuccessBp < 0 || claimedSuccessBp > BP_DENOMINATOR) {
    throw new RangeError(`verifySuccess: invalid claimedSuccessBp=${claimedSuccessBp}`);
  }
  const randomValue = typeof randomValueStr === 'bigint'
    ? randomValueStr
    : BigInt(randomValueStr);
  const roll = Number(randomValue % BP_DENOM_BIG);   // 0~9999
  return roll < claimedSuccessBp;
}

/**
 * @returns {string|null} lowercase 정규화된 주소, 또는 형식이 틀리면 null
 */
function normalizeAddress(addr) {
  if (typeof addr !== 'string' || !ADDRESS_RE.test(addr)) {
    return null;
  }
  return addr.toLowerCase();
}

module.exports = { verifySuccess, normalizeAddress };

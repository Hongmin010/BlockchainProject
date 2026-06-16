/**
 * ============================================================
 *  업적 payload 해시 모듈 (순수 함수 — DB/네트워크 접근 없음)
 * ============================================================
 *
 *  오프체인 판정 업적(ID 3, 4, 5)의 근거(payload)를 컨트랙트
 *  mintAchievement(to, achievementId, dataHash) 의 dataHash 로 커밋한다.
 *  제3자는 /api/achievements/:wallet/:achievementId/proof 로 payload 원본을
 *  받아 이 모듈과 동일한 방식으로 해시를 재계산 → 온체인 dataHash 와 대조한다.
 *
 *  인코딩 스펙 (컨트랙트와 바이트 단위 일치 필수)
 *  ----------------------------------------------
 *  keccak256( AbiCoder.defaultAbiCoder().encode(타입배열, 값배열) )
 *   - Solidity 쪽 재현: keccak256(abi.encode(wallet, achievementId,
 *     evidenceA, evidenceB, fromBlock, toBlock))
 *   - ⚠️ abi.encodePacked / solidityPackedKeccak256 / JSON 문자열 해시 금지.
 *  타입·순서는 constants/achievements.js 의 ACHIEVEMENT_PAYLOAD_TYPES
 *  한 곳에만 정의되어 있다 (여기서 import).
 */

const { ethers } = require('ethers');
const { ACHIEVEMENT_PAYLOAD_TYPES } = require('../constants/achievements');

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const UINT256_MAX = 2n ** 256n - 1n;

/** uint256 필드 검증 + BigInt 변환 (number/string/bigint 허용). */
function toUint256(name, value) {
  if (value === null || value === undefined) {
    throw new TypeError(`${name} 누락 — uint256 값이 필요하다`);
  }
  if (typeof value === 'number' && !Number.isSafeInteger(value)) {
    throw new RangeError(`${name}=${value} — 안전 정수 범위를 벗어난 number 는 문자열/BigInt 로 넘길 것`);
  }
  let big;
  try {
    big = BigInt(value);
  } catch {
    throw new TypeError(`${name}=${value} — uint256 으로 변환 불가`);
  }
  if (big < 0n || big > UINT256_MAX) {
    throw new RangeError(`${name}=${value} — uint256 범위(0 ~ 2^256-1) 밖`);
  }
  return big;
}

/**
 * 입력 필드를 검증·정규화한 payload 객체로 만든다.
 *  - wallet: 소문자 hex (DB 컨벤션과 동일)
 *  - 나머지: 10진수 문자열 (JSONB 저장·JSON 직렬화 안전)
 * 반환된 객체가 DB payload 컬럼에 그대로 저장되는 "근거 원본"이다.
 */
function buildPayload({ wallet, achievementId, evidenceA, evidenceB, fromBlock, toBlock }) {
  if (typeof wallet !== 'string' || !ADDRESS_RE.test(wallet)) {
    throw new TypeError(`wallet=${wallet} — 0x + 40 hex 주소가 아니다`);
  }
  return {
    wallet: wallet.toLowerCase(),
    achievementId: toUint256('achievementId', achievementId).toString(),
    evidenceA: toUint256('evidenceA', evidenceA).toString(),
    evidenceB: toUint256('evidenceB', evidenceB).toString(),
    fromBlock: toUint256('fromBlock', fromBlock).toString(),
    toBlock: toUint256('toBlock', toBlock).toString(),
  };
}

/** payload → abi.encode 바이트 (0x hex). 디버깅·테스트 벡터 출력용으로도 노출. */
function encodePayload(fields) {
  const p = buildPayload(fields); // 이미 정규화된 payload 를 다시 넣어도 동일 결과 (멱등)
  return ethers.AbiCoder.defaultAbiCoder().encode(ACHIEVEMENT_PAYLOAD_TYPES, [
    p.wallet,
    BigInt(p.achievementId),
    BigInt(p.evidenceA),
    BigInt(p.evidenceB),
    BigInt(p.fromBlock),
    BigInt(p.toBlock),
  ]);
}

/** payload → dataHash (keccak256, 0x + 64 hex). 컨트랙트에 커밋하는 값. */
function hashPayload(fields) {
  return ethers.keccak256(encodePayload(fields));
}

module.exports = { buildPayload, encodePayload, hashPayload };

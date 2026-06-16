/**
 * ============================================================
 *  업적 시스템 상수 — 컨트랙트팀과 합의 완료 (2026-06-12, 변경 금지)
 * ============================================================
 *
 *  업적 ID / 판정 위치 / payload 인코딩 타입을 한 곳에서만 정의한다.
 *  다른 모든 코드(해시 모듈, 판정 모듈, 인덱서, API)는 이 모듈을 import 한다.
 *
 *  판정 위치 경계 (절대 넘지 말 것)
 *  --------------------------------
 *  - onchain  (ID 1, 2): 컨트랙트가 판정·emit. 백엔드는 AchievementUnlocked
 *    이벤트 인덱싱만 한다. 백엔드 재판정 금지.
 *  - offchain (ID 3, 4, 5): 백엔드가 판정 → payload 해시 커밋(dataHash) →
 *    mintAchievement 호출. 컨트랙트는 dataHash 를 박제만 한다.
 */

// ─── 업적 ID (컨트랙트와 카톡 합의 — 변경 금지) ───────────────
const ACHIEVEMENT_IDS = Object.freeze({
  VERIFIER: 1,        // 검증자
  MANLY_MAN: 2,       // 상남자
  CERTIFIED_SUCKER: 3,// 공식인증 호구
  HEAVENLY_LUCK: 4,   // 천운
  CAT_BUTLER: 5,      // 다둥이 집사
});

const ACHIEVEMENT_META = Object.freeze({
  1: Object.freeze({ id: 1, name: '검증자', source: 'onchain', condition: '누적 강화 100회' }),
  2: Object.freeze({ id: 2, name: '상남자', source: 'onchain', condition: 'Safe 모드 0회로 15강 도달 (아이템별 usedSafe 플래그)' }),
  3: Object.freeze({ id: 3, name: '공식인증 호구', source: 'offchain', condition: '관측 성공률이 기대 성공률 대비 Wilson 95% CI 밖으로 유의하게 낮음' }),
  4: Object.freeze({ id: 4, name: '천운', source: 'offchain', condition: '관측 성공률이 기대 성공률 대비 Wilson 95% CI 밖으로 유의하게 높음' }),
  5: Object.freeze({ id: 5, name: '다둥이 집사', source: 'offchain', condition: '동시에 10강 이상 고양이 5마리 보유' }),
});

// ─── dataHash payload 인코딩 스펙 (컨트랙트와 바이트 단위 일치 필수) ───
//
//  keccak256( AbiCoder.defaultAbiCoder().encode(ACHIEVEMENT_PAYLOAD_TYPES, values) )
//  ⚠️ abi.encodePacked / solidityPackedKeccak256 / JSON 문자열 해시 절대 금지.
//
//  타입·순서 (여기 한 곳에만 정의 — 수정 시 컨트랙트와 동시 변경):
//    [address wallet, uint256 achievementId, uint256 evidenceA, uint256 evidenceB,
//     uint256 fromBlock, uint256 toBlock]
//
//  evidence 의미:
//    - ID 3, 4 → evidenceA = 성공수, evidenceB = 시도수
//    - ID 5    → evidenceA = 10강 이상 마리수, evidenceB = 0
//  fromBlock/toBlock = 판정에 사용한 인덱싱 데이터의 블록 범위 (재검증 재현용).
const ACHIEVEMENT_PAYLOAD_TYPES = Object.freeze([
  'address',  // wallet
  'uint256',  // achievementId
  'uint256',  // evidenceA
  'uint256',  // evidenceB
  'uint256',  // fromBlock
  'uint256',  // toBlock
]);

// ─── 오프체인 판정 파라미터 ───────────────────────────────────
const LUCK_MIN_ATTEMPTS = 30;     // ID 3/4: 표본 30회 미만이면 판정 스킵 (소표본 오탐 방지)
const CAT_BUTLER_MIN_LEVEL = 10;  // ID 5: 10강 이상
const CAT_BUTLER_MIN_COUNT = 5;   // ID 5: 5마리 이상

module.exports = {
  ACHIEVEMENT_IDS,
  ACHIEVEMENT_META,
  ACHIEVEMENT_PAYLOAD_TYPES,
  LUCK_MIN_ATTEMPTS,
  CAT_BUTLER_MIN_LEVEL,
  CAT_BUTLER_MIN_COUNT,
};

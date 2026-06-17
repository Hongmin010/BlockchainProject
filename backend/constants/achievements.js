/**
 * ============================================================
 *  업적 시스템 상수 — 실제 배포 컨트랙트(EnhancementAchievements) 기준
 * ============================================================
 *
 *  업적 ID / 판정 위치 / payload 인코딩 타입을 한 곳에서만 정의한다.
 *  다른 모든 코드(해시 모듈, 판정 모듈, 인덱서, API)는 이 모듈을 import 한다.
 *
 *  배포 컨트랙트: 0x7b5a6404bda67B085aA40aEFbfe72AB9BD28dd4B (Base Sepolia)
 *
 *  판정 위치 경계 (절대 넘지 말 것)
 *  --------------------------------
 *  - offchain (ID 3, 4, 5): 컨트랙트가 on-chain 으로 못 하는 통계 판정.
 *    백엔드가 판정 → payload 해시 커밋(dataHash) → mintAchievement(user, tokenId, dataHash) 호출.
 *    컨트랙트는 dataHash 를 achievementDataHash[user][tokenId] 에 박제만 한다(검증 X).
 *    민트 시 AchievementMinted 이벤트 emit → 인덱서가 박제.
 *  - onchain  (ID 6~10): 컨트랙트가 getAchievementStats 로 자체 판정.
 *    사용자 claim* / owner award* 호출 → AchievementClaimed 이벤트 emit.
 *    백엔드는 이벤트 인덱싱만 한다. 백엔드 재판정·민트 금지.
 *
 *  ⚠️ 구 ID 1(검증자)/2(상남자)는 드롭 — 배포 컨트랙트에도 백엔드 판정에도 없음.
 */

// ─── 업적 ID (배포 컨트랙트 토큰 ID 기준) ─────────────────────
const ACHIEVEMENT_IDS = Object.freeze({
  // 오프체인(백엔드 판정 → 민트)
  CERTIFIED_SUCKER: 3,        // 공식인증 호구
  HEAVENLY_LUCK: 4,           // 천운
  CAT_BUTLER: 5,              // 다둥이 집사
  // 온체인(컨트랙트 자체 판정 → 백엔드 인덱싱). 값은 컨트랙트 상수와 일치.
  MAX_ENHANCEMENT: 6,         // 최고 강화 (MAX_ENHANCEMENT_ACHIEVEMENT_ID)
  SUCCESS_STREAK: 7,          // 연속 성공   (SUCCESS_STREAK_ACHIEVEMENT_ID)
  DESTRUCTION_SURVIVOR: 8,    // 파괴 생존자 (DESTRUCTION_SURVIVOR_ACHIEVEMENT_ID)
  GUARANTEED_SAFE: 9,         // 보장 성공   (GUARANTEED_SAFE_ACHIEVEMENT_ID)
  VERTICAL_DROP: 10,          // 수직 낙하   (VERTICAL_DROP_ACHIEVEMENT_ID)
});

const ACHIEVEMENT_META = Object.freeze({
  // ── 오프체인: 백엔드가 판정 → dataHash 커밋 → 민트 ──
  3: Object.freeze({ id: 3, name: '공식인증 호구', source: 'offchain', condition: '관측 성공률이 기대 성공률 대비 Wilson 95% CI 밖으로 유의하게 낮음' }),
  4: Object.freeze({ id: 4, name: '천운',          source: 'offchain', condition: '관측 성공률이 기대 성공률 대비 Wilson 95% CI 밖으로 유의하게 높음' }),
  5: Object.freeze({ id: 5, name: '다둥이 집사',   source: 'offchain', condition: '동시에 10강 이상 고양이 5마리 보유' }),
  // ── 온체인: 컨트랙트 자체 판정(getAchievementStats) → 백엔드 인덱싱 ──
  6:  Object.freeze({ id: 6,  name: '최고 강화',   source: 'onchain', condition: '아이템 총강화 레벨 20 도달' }),
  7:  Object.freeze({ id: 7,  name: '연속 성공',   source: 'onchain', condition: '최대 연속 성공 3회 이상' }),
  8:  Object.freeze({ id: 8,  name: '파괴 생존자', source: 'onchain', condition: '20강 도달 + 누적 파괴 5회 이상' }),
  9:  Object.freeze({ id: 9,  name: '보장 성공',   source: 'onchain', condition: '보장 성공(streak 보장) 누적 10회 이상' }),
  10: Object.freeze({ id: 10, name: '수직 낙하',   source: 'onchain', condition: '파괴 시 레벨 하락 폭 10 이상' }),
});

// ─── dataHash payload 인코딩 스펙 (오프체인 업적 3·4·5 전용) ───
//
//  keccak256( AbiCoder.defaultAbiCoder().encode(ACHIEVEMENT_PAYLOAD_TYPES, values) )
//  ⚠️ abi.encodePacked / solidityPackedKeccak256 / JSON 문자열 해시 절대 금지.
//
//  배포 컨트랙트는 dataHash 를 검증하지 않고 박제만 하므로, 이 인코딩은
//  "백엔드↔제3자 재검증(/proof)" 용 자체 규약이다. (컨트랙트와의 바이트 일치 불요)
//
//  타입·순서 (여기 한 곳에만 정의):
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

// 판정 주체별 ID 집합 (인덱서·API 분기용)
const OFFCHAIN_IDS = Object.freeze([3, 4, 5]);
const ONCHAIN_IDS = Object.freeze([6, 7, 8, 9, 10]);

module.exports = {
  ACHIEVEMENT_IDS,
  ACHIEVEMENT_META,
  ACHIEVEMENT_PAYLOAD_TYPES,
  LUCK_MIN_ATTEMPTS,
  CAT_BUTLER_MIN_LEVEL,
  CAT_BUTLER_MIN_COUNT,
  OFFCHAIN_IDS,
  ONCHAIN_IDS,
};

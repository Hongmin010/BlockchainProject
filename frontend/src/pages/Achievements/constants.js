// 업적 전용 페이지 상수 — 백엔드 라이브 업적 시스템(ID 3~10, 8종) 기준
//
// 실 API(GET /api/achievements/:wallet)가 main에 배포 완료됨.
// USE_MOCK_ACHIEVEMENTS = false 로 실 API(fetchAchievements)를 사용한다.
// (배포 전 미리보기나 디자인 확인이 필요하면 true 로 돌려 MOCK 데이터로 렌더)

export const USE_MOCK_ACHIEVEMENTS = false;

// achievementId별 화면 표시 아이콘.
// 이름/조건/획득여부는 API(또는 MOCK)에서 받아온 값을 사용한다.
// ⚠️ 라이브 API가 반환하는 ID는 3~10 — 새 ID가 추가돼도 fallback(🏆)으로 안전하게 렌더된다.
export const ACHIEVEMENT_DISPLAY = {
  3: { icon: '😭' },   // 공식인증 호구 (offchain)
  4: { icon: '🍀' },   // 천운 (offchain)
  5: { icon: '🐱' },   // 다둥이 집사 (offchain)
  6: { icon: '👑' },   // 최고 강화 (onchain, 만렙 20)
  7: { icon: '🎯' },   // 연속 성공 (onchain)
  8: { icon: '🛡️' },  // 파괴 생존자 (onchain)
  9: { icon: '🌟' },   // 보장 성공 (onchain)
  10: { icon: '📉' },  // 수직 낙하 (onchain)
};

// status → 획득 배지 문구 (unlocked === true 인 경우)
export const STATUS_LABEL = {
  minted: '획득',
  detected: '발급 대기',
  minting: '발급 중',
  failed: '발급 실패',
};

// 백엔드 GET /api/achievements/:wallet 응답 형태를 그대로 흉내낸 더미 데이터.
// USE_MOCK_ACHIEVEMENTS = true 일 때만 사용. 획득 2 / 미획득 6 으로 두 섹션을 모두 보여준다.
export const MOCK_ACHIEVEMENTS = [
  {
    achievementId: 4, name: '천운', source: 'offchain',
    condition: '관측 성공률이 기대 성공률 대비 Wilson 95% CI 밖으로 유의하게 높음',
    unlocked: true, status: 'minted',
    itemId: null, txHash: '0x7e3b00000000000000000000000000000000000000000000000000000000e558',
    dataHash: '0x67df000000000000000000000000000000000000000000000000000000007826',
    mintedAt: '2026-06-12T10:30:00Z', proofUrl: '/api/achievements/0xMOCK/4/proof',
  },
  {
    achievementId: 6, name: '최고 강화', source: 'onchain',
    condition: '아이템 총강화 레벨 20 도달',
    unlocked: true, status: 'minted',
    itemId: 1, txHash: '0xabc1234567890000000000000000000000000000000000000000000000001234',
    dataHash: null, mintedAt: '2026-06-12T09:00:00Z', proofUrl: null,
  },
  {
    achievementId: 3, name: '공식인증 호구', source: 'offchain',
    condition: '관측 성공률이 기대 성공률 대비 Wilson 95% CI 밖으로 유의하게 낮음',
    unlocked: false, status: null,
    itemId: null, txHash: null, dataHash: null, mintedAt: null, proofUrl: null,
  },
  {
    achievementId: 5, name: '다둥이 집사', source: 'offchain',
    condition: '동시에 10강 이상 고양이 5마리 보유',
    unlocked: false, status: null,
    itemId: null, txHash: null, dataHash: null, mintedAt: null, proofUrl: null,
  },
  {
    achievementId: 7, name: '연속 성공', source: 'onchain',
    condition: '최대 연속 성공 3회 이상',
    unlocked: false, status: null,
    itemId: null, txHash: null, dataHash: null, mintedAt: null, proofUrl: null,
  },
  {
    achievementId: 8, name: '파괴 생존자', source: 'onchain',
    condition: '20강 도달 + 누적 파괴 5회 이상',
    unlocked: false, status: null,
    itemId: null, txHash: null, dataHash: null, mintedAt: null, proofUrl: null,
  },
  {
    achievementId: 9, name: '보장 성공', source: 'onchain',
    condition: '보장 성공(streak 보장) 누적 10회 이상',
    unlocked: false, status: null,
    itemId: null, txHash: null, dataHash: null, mintedAt: null, proofUrl: null,
  },
  {
    achievementId: 10, name: '수직 낙하', source: 'onchain',
    condition: '파괴 시 레벨 하락 폭 10 이상',
    unlocked: false, status: null,
    itemId: null, txHash: null, dataHash: null, mintedAt: null, proofUrl: null,
  },
];

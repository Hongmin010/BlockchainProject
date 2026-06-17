// 업적 전용 페이지 상수 — 신규 v5 업적 시스템(합의 ID 1~5) 기준
//
// 백엔드 v5(GET /api/achievements/:wallet)가 main에 머지·배포되기 전까지는
// MOCK 데이터로 화면을 채운다. 배포 후 USE_MOCK_ACHIEVEMENTS = false 로 바꾸면
// 실 API(fetchAchievements)를 사용한다.

export const USE_MOCK_ACHIEVEMENTS = true;

// achievementId(1~5)별 화면 표시 정보 (아이콘·등급).
// 이름/조건/획득여부는 API(또는 MOCK)에서 받아온 값을 사용한다.
export const ACHIEVEMENT_DISPLAY = {
  1: { icon: '🔍', rarity: 'Epic' },       // 검증자
  2: { icon: '🔥', rarity: 'Legendary' },  // 상남자
  3: { icon: '😭', rarity: 'Epic' },       // 공식인증 호구
  4: { icon: '🍀', rarity: 'Legendary' },  // 천운
  5: { icon: '🐱', rarity: 'Epic' },       // 다둥이 집사
};

export const RARITY_LABEL = {
  Epic: '에픽',
  Legendary: '레전더리',
  Mythic: '미식',
};

// status → 획득 배지 문구 (unlocked === true 인 경우)
export const STATUS_LABEL = {
  minted: '획득',
  detected: '발급 대기',
  minting: '발급 중',
  failed: '발급 실패',
};

// 백엔드 v5 GET /api/achievements/:wallet 응답 형태를 그대로 흉내낸 더미 데이터.
// 획득 2 / 미획득 3 으로 두 섹션을 모두 보여준다.
export const MOCK_ACHIEVEMENTS = [
  {
    achievementId: 1, name: '검증자', source: 'onchain',
    condition: '누적 강화 100회',
    unlocked: true, status: 'minted',
    itemId: null, txHash: '0xabc1234567890000000000000000000000000000000000000000000000001234',
    dataHash: null, mintedAt: '2026-06-12T09:00:00Z', proofUrl: null,
  },
  {
    achievementId: 4, name: '천운', source: 'offchain',
    condition: '관측 성공률이 기대 성공률 대비 Wilson 95% CI 밖으로 유의하게 높음',
    unlocked: true, status: 'minted',
    itemId: null, txHash: '0x7e3b00000000000000000000000000000000000000000000000000000000e558',
    dataHash: '0x67df000000000000000000000000000000000000000000000000000000007826',
    mintedAt: '2026-06-12T10:30:00Z', proofUrl: '/api/achievements/0xMOCK/4/proof',
  },
  {
    achievementId: 2, name: '상남자', source: 'onchain',
    condition: 'Safe 모드 0회로 15강 도달',
    unlocked: false, status: null,
    itemId: null, txHash: null, dataHash: null, mintedAt: null, proofUrl: null,
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
];

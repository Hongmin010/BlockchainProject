/**
 * ============================================================
 *  업적 NFT(EnhancementAchievements) 조회 유틸 — T10
 * ============================================================
 *
 *  배경
 *  ----
 *  컨트랙트팀이 배포한 업적 NFT 컨트랙트(EnhancementAchievements,
 *  Base Sepolia)는 계정당 업적별 1회 발급 구조다. 백엔드는 발급
 *  여부를 조회해서 프론트 시각화용으로 내려준다.
 *
 *  설계 결정: read-on-demand (인덱서/DB 미사용)
 *  --------------------------------------------
 *  계정당 1개 발급 + 조회 빈도 낮음 → AchievementClaimed 이벤트를
 *  인덱싱하는 것은 과투자. API 요청 시점에 RPC view 호출로 충분하다.
 *  업적 종류가 늘어나 N+1 조회가 부담되면 그때 멀티콜/인덱싱 검토.
 *
 *  ABI 출처: contracts/scripts/claimMaxAchievement.js (컨트랙트팀, work 브랜치)
 *  — 쓰기 함수(claim/award)는 지갑 서명이 필요해 백엔드 범위 밖이므로
 *    조회(view) 함수만 사용한다.
 *
 *  테스트 용이성: createAchievementsClient 에 contract 객체를 직접
 *  주입할 수 있어 네트워크 없이 단위 테스트 가능.
 * ============================================================
 */

'use strict';

const { ethers } = require('ethers');

const ACHIEVEMENT_ABI = [
  'function hasAchievement(address user, uint256 achievementId) view returns (bool)',
  'function canClaimMaxEnhancement(address user, uint256 itemId) view returns (bool)',
  'function MAX_ENHANCEMENT_ACHIEVEMENT_ID() view returns (uint256)',
  'function maxLevel() view returns (uint8)',
  'event AchievementClaimed(address indexed user, uint256 indexed achievementId, uint256 indexed itemId, uint8 totalLevel)',
];

/**
 * 업적 레지스트리 — 컨트랙트가 노출하는 업적 목록.
 *
 *  achievementId 는 온체인 상수와 일치해야 한다
 *  (MAX_ENHANCEMENT_ACHIEVEMENT_ID() == 1, 2026-06-10 온체인 확인).
 *  컨트랙트팀이 업적을 추가 배포하면 여기에 한 줄씩 추가한다.
 */
const ACHIEVEMENTS = [
  {
    achievementId: 1,
    key: 'max_enhancement',
    label: '최대 강화 달성',
    description: 'totalLevel 이 maxLevel(=10, base 5 + 고급강화 extra 5)에 도달',
  },
];

/**
 * 업적 조회 클라이언트 생성.
 *
 *   opts.rpcUrl / opts.contractAddress : 운영 경로 (lazy 로 Contract 생성)
 *   opts.contract                      : 테스트 경로 (mock 주입, rpc 설정 무시)
 *
 *  반환 객체
 *   - isConfigured(): RPC 설정 여부 — 미설정이면 라우트가 503 으로 응답
 *   - getUserAchievements(user): 레지스트리 전체의 발급 여부 [{ ..., claimed }]
 *   - canClaimMaxEnhancement(user, itemId): 클레임 가능 여부 (강화 완료 && 미발급)
 */
function createAchievementsClient({ rpcUrl, contractAddress, contract } = {}) {
  let cached = contract ?? null;
  const configured = Boolean(cached || (rpcUrl && contractAddress));

  function getContract() {
    if (!cached) {
      const provider = new ethers.JsonRpcProvider(rpcUrl);
      cached = new ethers.Contract(contractAddress, ACHIEVEMENT_ABI, provider);
    }
    return cached;
  }

  return {
    address: contractAddress ?? null,

    isConfigured() {
      return configured;
    },

    async getUserAchievements(user) {
      const c = getContract();
      const claimed = await Promise.all(
        ACHIEVEMENTS.map((a) => c.hasAchievement(user, a.achievementId)),
      );
      return ACHIEVEMENTS.map((a, i) => ({ ...a, claimed: Boolean(claimed[i]) }));
    },

    async canClaimMaxEnhancement(user, itemId) {
      return Boolean(await getContract().canClaimMaxEnhancement(user, itemId));
    },

    /**
     * 주소 목록 중 업적을 1개 이상 보유한 지갑의 목록.
     * 후보 주소는 호출자가 공급한다 (API 라우트는 attempts 테이블의
     * distinct user 를 사용 — 강화를 한 번도 안 한 지갑은 업적이 있을 수 없음).
     *
     *  정렬: 보유 업적 수 내림차순, 동률이면 주소 오름차순(결정적 순서 보장).
     *  미보유(0개) 주소는 제외한다.
     *
     * @param {string[]} users 소문자 주소 배열
     * @returns {Promise<[{ userAddress, claimedCount, claimedKeys }]>}
     */
    async getAchievementHolders(users) {
      const c = getContract();
      const rows = await Promise.all(users.map(async (user) => {
        const claimed = await Promise.all(
          ACHIEVEMENTS.map((a) => c.hasAchievement(user, a.achievementId)),
        );
        const claimedKeys = ACHIEVEMENTS.filter((_, i) => claimed[i]).map((a) => a.key);
        return { userAddress: user, claimedCount: claimedKeys.length, claimedKeys };
      }));
      return rows
        .filter((r) => r.claimedCount > 0)
        .sort((x, y) => y.claimedCount - x.claimedCount
          || (x.userAddress < y.userAddress ? -1 : 1));
    },
  };
}

module.exports = { ACHIEVEMENT_ABI, ACHIEVEMENTS, createAchievementsClient };

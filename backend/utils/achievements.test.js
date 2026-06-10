/**
 * ============================================================
 *  utils/achievements.js 단위 테스트 — node:test
 *  실행: npm test
 * ============================================================
 *  mock contract 주입으로 네트워크 없이 검증.
 * ============================================================
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { ACHIEVEMENTS, createAchievementsClient } = require('./achievements');

// ------------------------------------------------------------
//  mock contract — 호출 인자를 기록하고 정해진 답을 돌려준다
// ------------------------------------------------------------
function mockContract({ claimedIds = [], canClaim = false } = {}) {
  const calls = { hasAchievement: [], canClaimMaxEnhancement: [] };
  return {
    calls,
    async hasAchievement(user, achievementId) {
      calls.hasAchievement.push({ user, achievementId });
      return claimedIds.includes(achievementId);
    },
    async canClaimMaxEnhancement(user, itemId) {
      calls.canClaimMaxEnhancement.push({ user, itemId });
      return canClaim;
    },
  };
}


// ------------------------------------------------------------
//  레지스트리
// ------------------------------------------------------------
test('레지스트리: max_enhancement(id=1) 가 등록되어 있다', () => {
  const maxEnh = ACHIEVEMENTS.find((a) => a.key === 'max_enhancement');
  assert.ok(maxEnh);
  assert.equal(maxEnh.achievementId, 1); // 온체인 MAX_ENHANCEMENT_ACHIEVEMENT_ID 와 일치
});


// ------------------------------------------------------------
//  isConfigured
// ------------------------------------------------------------
test('isConfigured: 설정 없음 → false', () => {
  assert.equal(createAchievementsClient().isConfigured(), false);
  assert.equal(createAchievementsClient({ rpcUrl: 'https://x' }).isConfigured(), false);
  assert.equal(createAchievementsClient({ contractAddress: '0xabc' }).isConfigured(), false);
});

test('isConfigured: rpcUrl+contractAddress 또는 contract 주입 → true', () => {
  assert.equal(
    createAchievementsClient({ rpcUrl: 'https://x', contractAddress: '0xabc' }).isConfigured(),
    true,
  );
  assert.equal(createAchievementsClient({ contract: mockContract() }).isConfigured(), true);
});


// ------------------------------------------------------------
//  getUserAchievements
// ------------------------------------------------------------
test('getUserAchievements: 레지스트리 전체에 claimed 플래그를 붙인다', async () => {
  const contract = mockContract({ claimedIds: [1] });
  const client = createAchievementsClient({ contract });

  const result = await client.getUserAchievements('0xUSER');

  assert.equal(result.length, ACHIEVEMENTS.length);
  assert.equal(result[0].key, 'max_enhancement');
  assert.equal(result[0].claimed, true);
  // 레지스트리의 모든 업적을 1회씩 조회했는지
  assert.equal(contract.calls.hasAchievement.length, ACHIEVEMENTS.length);
  assert.deepEqual(contract.calls.hasAchievement[0], { user: '0xUSER', achievementId: 1 });
});

test('getUserAchievements: 미발급이면 claimed=false', async () => {
  const client = createAchievementsClient({ contract: mockContract({ claimedIds: [] }) });
  const result = await client.getUserAchievements('0xUSER');
  assert.ok(result.every((a) => a.claimed === false));
});

test('getUserAchievements: 원본 레지스트리를 변형하지 않는다', async () => {
  const client = createAchievementsClient({ contract: mockContract({ claimedIds: [1] }) });
  await client.getUserAchievements('0xUSER');
  assert.equal('claimed' in ACHIEVEMENTS[0], false);
});


// ------------------------------------------------------------
//  canClaimMaxEnhancement
// ------------------------------------------------------------
test('canClaimMaxEnhancement: 컨트랙트 응답을 boolean 으로 전달', async () => {
  const contract = mockContract({ canClaim: true });
  const client = createAchievementsClient({ contract });

  assert.equal(await client.canClaimMaxEnhancement('0xUSER', '72'), true);
  assert.deepEqual(contract.calls.canClaimMaxEnhancement[0], { user: '0xUSER', itemId: '72' });
});

test('canClaimMaxEnhancement: RPC 에러는 그대로 전파 (라우트에서 502 처리)', async () => {
  const contract = {
    async canClaimMaxEnhancement() { throw new Error('rpc down'); },
  };
  const client = createAchievementsClient({ contract });
  await assert.rejects(() => client.canClaimMaxEnhancement('0xUSER', '1'), /rpc down/);
});

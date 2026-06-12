/**
 * lib/achievementJudge.js 단위 테스트
 *  - 순수 판정 함수: Wilson CI 안/밖, 표본 30회 미만 스킵, 상호배타, 경계값
 *  - checkOffchainAchievements: fake db 시드 데이터로 쿼리·INSERT 흐름 검증
 */

const { test } = require('node:test');
const assert = require('node:assert');

const { judgeLuck, judgeCatButler, checkOffchainAchievements } = require('./achievementJudge');
const { hashPayload } = require('./achievementHash');
const { wilson95Bp } = require('../utils/stats');

// ─── judgeLuck: 순수 판정 ────────────────────────────────────

test('judgeLuck: 표본 29회 → 판정 스킵 (소표본 오탐 방지)', () => {
  const v = judgeLuck({ successes: 0, total: 29, expectedRateBp: 5000 });
  assert.strictEqual(v.skipped, true);
  assert.strictEqual(v.achievementId, null);
});

test('judgeLuck: 표본 30회부터 판정 수행', () => {
  const v = judgeLuck({ successes: 5, total: 30, expectedRateBp: 5000 });
  assert.strictEqual(v.skipped, false);
});

test('judgeLuck: 5/30 성공, 기대 50% → CI 상한 < 기대 → ID 3 (호구)', () => {
  const v = judgeLuck({ successes: 5, total: 30, expectedRateBp: 5000 });
  assert.strictEqual(v.achievementId, 3);
  assert.ok(v.ci.highBp < 5000);
});

test('judgeLuck: 25/30 성공, 기대 50% → CI 하한 > 기대 → ID 4 (천운)', () => {
  const v = judgeLuck({ successes: 25, total: 30, expectedRateBp: 5000 });
  assert.strictEqual(v.achievementId, 4);
  assert.ok(v.ci.lowBp > 5000);
});

test('judgeLuck: 15/30 성공, 기대 50% → CI 안 → 발동 없음', () => {
  const v = judgeLuck({ successes: 15, total: 30, expectedRateBp: 5000 });
  assert.strictEqual(v.achievementId, null);
});

test('judgeLuck: 경계 — 기대치가 정확히 CI 상한이면 미발동 (strict 비교)', () => {
  const ci = wilson95Bp(5, 30);
  const atBoundary = judgeLuck({ successes: 5, total: 30, expectedRateBp: ci.highBp });
  assert.strictEqual(atBoundary.achievementId, null);
  const justOutside = judgeLuck({ successes: 5, total: 30, expectedRateBp: ci.highBp + 1 });
  assert.strictEqual(justOutside.achievementId, 3);
});

test('judgeLuck: 경계 — 기대치가 정확히 CI 하한이면 미발동', () => {
  const ci = wilson95Bp(25, 30);
  const atBoundary = judgeLuck({ successes: 25, total: 30, expectedRateBp: ci.lowBp });
  assert.strictEqual(atBoundary.achievementId, null);
  const justOutside = judgeLuck({ successes: 25, total: 30, expectedRateBp: ci.lowBp - 1 });
  assert.strictEqual(justOutside.achievementId, 4);
});

test('judgeLuck: 3 과 4 는 상호배타 — 어떤 입력에도 동시 성립 불가', () => {
  for (let s = 0; s <= 40; s += 5) {
    for (const e of [0, 2500, 5000, 7500, 10000]) {
      const v = judgeLuck({ successes: s, total: 40, expectedRateBp: e });
      assert.ok([null, 3, 4].includes(v.achievementId));
      if (v.achievementId !== null) {
        // CI 상한 미만(3)과 CI 하한 초과(4)는 lowBp ≤ highBp 라 양립 불가
        assert.ok(!(v.ci.highBp < e && v.ci.lowBp > e));
      }
    }
  }
});

// ─── judgeCatButler ──────────────────────────────────────────

test('judgeCatButler: 4마리 → false, 5마리 → true (경계)', () => {
  assert.strictEqual(judgeCatButler({ count: 4 }), false);
  assert.strictEqual(judgeCatButler({ count: 5 }), true);
  assert.strictEqual(judgeCatButler({ count: 6 }), true);
});

// ─── checkOffchainAchievements: fake db 시드 ─────────────────

const WALLET = '0xabcdef0123456789abcdef0123456789abcdef01';

/** SQL 본문으로 분기하는 fake db. inserts 배열에 INSERT 파라미터를 기록한다. */
function makeFakeDb({ luckRow, butlerRow, conflict = false }) {
  const inserts = [];
  return {
    inserts,
    async query(sql, params) {
      if (sql.includes('FROM attempts')) return { rows: [luckRow] };
      if (sql.includes('FROM user_items')) return { rows: [butlerRow] };
      if (sql.includes('INSERT INTO achievements')) {
        inserts.push(params);
        if (conflict) return { rows: [] };   // UNIQUE 충돌 → RETURNING 없음
        return {
          rows: [{
            id: inserts.length, wallet: params[0], achievement_id: params[1],
            source: 'offchain', payload: params[2], data_hash: params[3], status: 'detected',
          }],
        };
      }
      throw new Error(`fake db: 예상 못한 쿼리 — ${sql.slice(0, 60)}`);
    },
  };
}

test('checkOffchain: 천운(31/40, 기대 50%) + 다둥이(5마리) 동시 감지', async () => {
  const db = makeFakeDb({
    luckRow: { total: 40, successes: 31, sum_rate_bp: '200000', from_block: '100', to_block: '200' },
    butlerRow: { cnt: 5, to_block: '300' },
  });
  const detected = await checkOffchainAchievements(db, WALLET);

  assert.strictEqual(detected.length, 2);
  assert.deepStrictEqual(detected.map((d) => d.achievement_id), [4, 5]);

  // ID 4 payload: A=성공수 31, B=시도수 40, 블록 범위 100~200
  const p4 = JSON.parse(db.inserts[0][2]);
  assert.deepStrictEqual(p4, {
    wallet: WALLET, achievementId: '4', evidenceA: '31', evidenceB: '40',
    fromBlock: '100', toBlock: '200',
  });
  // data_hash 는 payload 의 해시와 일치해야 한다 (proof 재검증 무결성)
  assert.strictEqual(db.inserts[0][3], hashPayload(p4));

  // ID 5 payload: A=마리수 5, B=0, toBlock=user_items 최신 블록
  const p5 = JSON.parse(db.inserts[1][2]);
  assert.deepStrictEqual(p5, {
    wallet: WALLET, achievementId: '5', evidenceA: '5', evidenceB: '0',
    fromBlock: '0', toBlock: '300',
  });
  assert.strictEqual(db.inserts[1][3], hashPayload(p5));
});

test('checkOffchain: 표본 29회 + 4마리 → 아무것도 감지 안 함 (INSERT 자체가 없음)', async () => {
  const db = makeFakeDb({
    luckRow: { total: 29, successes: 2, sum_rate_bp: '145000', from_block: '1', to_block: '2' },
    butlerRow: { cnt: 4, to_block: '300' },
  });
  const detected = await checkOffchainAchievements(db, WALLET);
  assert.deepStrictEqual(detected, []);
  assert.strictEqual(db.inserts.length, 0);
});

test('checkOffchain: CI 안(20/40, 기대 50%) → 운 업적 미발동', async () => {
  const db = makeFakeDb({
    luckRow: { total: 40, successes: 20, sum_rate_bp: '200000', from_block: '1', to_block: '2' },
    butlerRow: { cnt: 0, to_block: '0' },
  });
  const detected = await checkOffchainAchievements(db, WALLET);
  assert.deepStrictEqual(detected, []);
});

test('checkOffchain: 호구(5/40, 기대 50%) → ID 3 감지', async () => {
  const db = makeFakeDb({
    luckRow: { total: 40, successes: 5, sum_rate_bp: '200000', from_block: '10', to_block: '20' },
    butlerRow: { cnt: 0, to_block: '0' },
  });
  const detected = await checkOffchainAchievements(db, WALLET);
  assert.strictEqual(detected.length, 1);
  assert.strictEqual(detected[0].achievement_id, 3);
});

test('checkOffchain: 이미 감지된 업적(UNIQUE 충돌) → 반환 배열에서 제외', async () => {
  const db = makeFakeDb({
    luckRow: { total: 40, successes: 31, sum_rate_bp: '200000', from_block: '100', to_block: '200' },
    butlerRow: { cnt: 5, to_block: '300' },
    conflict: true,
  });
  const detected = await checkOffchainAchievements(db, WALLET);
  assert.deepStrictEqual(detected, []);          // 새로 감지된 것 없음
  assert.strictEqual(db.inserts.length, 2);      // INSERT 시도는 했지만 충돌로 무시됨
});

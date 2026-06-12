/**
 * indexer — AchievementUnlocked 핸들러 fixture 테스트
 *
 *  실제 컨트랙트가 아직 없으므로, 합의된 fragment 인터페이스로
 *  가짜 이벤트 로그를 인코딩 → parseLog 라운드트립 → 핸들러 호출 순서로
 *  "진짜 로그가 도착했을 때"와 동일한 경로를 검증한다.
 *
 *  ⚠️ DB 의존: .env 의 DATABASE_URL 로 실DB에 INSERT 후 정리(DELETE)한다.
 *     테스트 지갑은 실사용 불가능한 주소(0x...00aa)를 쓴다.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { ethers } = require('ethers');

const db = require('../db/pool');
const { ACHIEVEMENTS_ABI, achievementHandlers } = require('./indexer');

const TEST_WALLET = '0x00000000000000000000000000000000000000aa';
const iface = new ethers.Interface(ACHIEVEMENTS_ABI);

async function cleanup() {
  await db.query(`DELETE FROM achievements WHERE wallet = $1`, [TEST_WALLET]);
}

before(cleanup);
after(async () => {
  await cleanup();
  await db.close();
});

test('fixture: AchievementUnlocked 인코딩 → parseLog 라운드트립', () => {
  // 컨트랙트가 emit 할 로그를 fragment 로 직접 만들어본다
  const encoded = iface.encodeEventLog('AchievementUnlocked', [
    TEST_WALLET, 2n, 77n,   // user, achievementId(상남자), itemId
  ]);
  const parsed = iface.parseLog({ topics: encoded.topics, data: encoded.data });

  assert.strictEqual(parsed.name, 'AchievementUnlocked');
  assert.strictEqual(parsed.args.user.toLowerCase(), TEST_WALLET);
  assert.strictEqual(parsed.args.achievementId, 2n);
  assert.strictEqual(parsed.args.itemId, 77n);
});

test('핸들러: 가짜 로그 1건 → achievements 에 onchain/minted 로 기록', async () => {
  const encoded = iface.encodeEventLog('AchievementUnlocked', [TEST_WALLET, 2n, 77n]);
  const parsed = iface.parseLog({ topics: encoded.topics, data: encoded.data });
  const meta = {
    txHash: '0x' + 'ab'.repeat(32),
    logIndex: 3,
    blockNumber: 26200000,
    blockTimestamp: new Date('2026-06-12T00:00:00Z'),
  };

  await achievementHandlers.AchievementUnlocked(parsed.args, meta);

  const { rows } = await db.query(
    `SELECT * FROM achievements WHERE wallet = $1 AND achievement_id = 2`,
    [TEST_WALLET],
  );
  assert.strictEqual(rows.length, 1);
  const row = rows[0];
  assert.strictEqual(row.source, 'onchain');
  assert.strictEqual(row.status, 'minted');         // 컨트랙트가 이미 발급 완료
  assert.strictEqual(row.item_id, '77');
  assert.strictEqual(row.tx_hash, meta.txHash);
  assert.strictEqual(Number(row.block_number), 26200000);
  assert.strictEqual(row.payload, null);            // 온체인 업적은 payload 없음
  assert.strictEqual(row.data_hash, null);
  assert.ok(row.minted_at);
});

test('핸들러 멱등성: 같은 이벤트 재처리(재인덱싱) → 여전히 1행', async () => {
  const encoded = iface.encodeEventLog('AchievementUnlocked', [TEST_WALLET, 2n, 77n]);
  const parsed = iface.parseLog({ topics: encoded.topics, data: encoded.data });
  const meta = {
    txHash: '0x' + 'ab'.repeat(32),
    logIndex: 3,
    blockNumber: 26200000,
    blockTimestamp: new Date('2026-06-12T00:00:00Z'),
  };

  await achievementHandlers.AchievementUnlocked(parsed.args, meta);   // 중복 호출
  await achievementHandlers.AchievementUnlocked(parsed.args, meta);

  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS cnt FROM achievements WHERE wallet = $1`,
    [TEST_WALLET],
  );
  assert.strictEqual(rows[0].cnt, 1);
});

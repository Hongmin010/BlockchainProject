/**
 * indexer — 업적 이벤트 핸들러 fixture 테스트 (실제 컨트랙트 ABI 기준)
 *
 *  배포 컨트랙트(EnhancementAchievements)의 두 이벤트를 fragment 로 직접
 *  인코딩 → parseLog 라운드트립 → 핸들러 호출 순서로, "진짜 로그가 도착했을 때"와
 *  동일한 경로를 검증한다.
 *    - AchievementMinted   : 오프체인 업적(3·4·5) 백엔드 민트 → source='offchain', data_hash 박제
 *    - AchievementClaimed  : 온체인 업적(6~10) 컨트랙트 자체판정 → source='onchain', item_id 박제
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
const MINTER = '0x0000000000000000000000000000000000000b0b';
const DATA_HASH = '0x' + 'cd'.repeat(32);
const iface = new ethers.Interface(ACHIEVEMENTS_ABI);

function meta(overrides = {}) {
  return {
    txHash: '0x' + 'ab'.repeat(32),
    logIndex: 3,
    blockNumber: 26200000,
    blockTimestamp: new Date('2026-06-12T00:00:00Z'),
    ...overrides,
  };
}

async function cleanup() {
  await db.query(`DELETE FROM achievements WHERE wallet = $1`, [TEST_WALLET]);
}

before(cleanup);
after(async () => {
  await cleanup();
  await db.close();
});

test('fixture: AchievementClaimed 인코딩 → parseLog 라운드트립', () => {
  const encoded = iface.encodeEventLog('AchievementClaimed', [
    TEST_WALLET, 7n, 77n, 15,   // user, achievementId(연속성공), itemId, totalLevel
  ]);
  const parsed = iface.parseLog({ topics: encoded.topics, data: encoded.data });

  assert.strictEqual(parsed.name, 'AchievementClaimed');
  assert.strictEqual(parsed.args.user.toLowerCase(), TEST_WALLET);
  assert.strictEqual(parsed.args.achievementId, 7n);
  assert.strictEqual(parsed.args.itemId, 77n);
  assert.strictEqual(parsed.args.totalLevel, 15n);
});

test('fixture: AchievementMinted 인코딩 → parseLog 라운드트립', () => {
  const encoded = iface.encodeEventLog('AchievementMinted', [
    TEST_WALLET, 4n, DATA_HASH, MINTER,   // user, tokenId(천운), dataHash, minter
  ]);
  const parsed = iface.parseLog({ topics: encoded.topics, data: encoded.data });

  assert.strictEqual(parsed.name, 'AchievementMinted');
  assert.strictEqual(parsed.args.user.toLowerCase(), TEST_WALLET);
  assert.strictEqual(parsed.args.tokenId, 4n);
  assert.strictEqual(parsed.args.dataHash, DATA_HASH);
  assert.strictEqual(parsed.args.minter.toLowerCase(), MINTER);
});

test('AchievementClaimed 핸들러: 온체인 업적 → achievements 에 onchain/minted 기록', async () => {
  const encoded = iface.encodeEventLog('AchievementClaimed', [TEST_WALLET, 7n, 77n, 15]);
  const parsed = iface.parseLog({ topics: encoded.topics, data: encoded.data });

  await achievementHandlers.AchievementClaimed(parsed.args, meta());

  const { rows } = await db.query(
    `SELECT * FROM achievements WHERE wallet = $1 AND achievement_id = 7`,
    [TEST_WALLET],
  );
  assert.strictEqual(rows.length, 1);
  const row = rows[0];
  assert.strictEqual(row.source, 'onchain');
  assert.strictEqual(row.status, 'minted');         // 컨트랙트가 이미 발급 완료
  assert.strictEqual(row.item_id, '77');
  assert.strictEqual(row.tx_hash, meta().txHash);
  assert.strictEqual(Number(row.block_number), 26200000);
  assert.strictEqual(row.payload, null);            // 온체인 업적은 payload 없음
  assert.strictEqual(row.data_hash, null);
  assert.ok(row.minted_at);
});

test('AchievementMinted 핸들러: 오프체인 업적 → offchain/minted + data_hash 박제', async () => {
  const encoded = iface.encodeEventLog('AchievementMinted', [TEST_WALLET, 4n, DATA_HASH, MINTER]);
  const parsed = iface.parseLog({ topics: encoded.topics, data: encoded.data });

  await achievementHandlers.AchievementMinted(parsed.args, meta());

  const { rows } = await db.query(
    `SELECT * FROM achievements WHERE wallet = $1 AND achievement_id = 4`,
    [TEST_WALLET],
  );
  assert.strictEqual(rows.length, 1);
  const row = rows[0];
  assert.strictEqual(row.source, 'offchain');
  assert.strictEqual(row.status, 'minted');
  assert.strictEqual(row.data_hash, DATA_HASH);     // 이벤트의 dataHash 박제
  assert.strictEqual(row.item_id, null);            // mint 이벤트엔 itemId 없음
  assert.ok(row.minted_at);
});

test('멱등성: 두 이벤트를 재처리(재인덱싱)해도 각 업적 1행 유지', async () => {
  const claimed = iface.parseLog(
    iface.encodeEventLog('AchievementClaimed', [TEST_WALLET, 7n, 77n, 15]),
  );
  const minted = iface.parseLog(
    iface.encodeEventLog('AchievementMinted', [TEST_WALLET, 4n, DATA_HASH, MINTER]),
  );

  await achievementHandlers.AchievementClaimed(claimed.args, meta());   // 중복 호출
  await achievementHandlers.AchievementClaimed(claimed.args, meta());
  await achievementHandlers.AchievementMinted(minted.args, meta());
  await achievementHandlers.AchievementMinted(minted.args, meta());

  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS cnt FROM achievements WHERE wallet = $1`,
    [TEST_WALLET],
  );
  assert.strictEqual(rows[0].cnt, 2);   // 업적 7, 4 각 1행
});

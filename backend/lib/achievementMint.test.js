/**
 * lib/achievementMint.js 단위 테스트 (fake db — 실 RPC/DB 없음)
 *  - MOCK_MINT=true 전 흐름: detected → minting → minted (가짜 tx_hash)
 *  - 실패 경로: failed + last_error 보관 → 재시도 가능
 *  - 선점 가드: detected/failed 가 아니면 아무것도 안 함
 */

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');

const { mintDetected, processPendingMints } = require('./achievementMint');

const ROW = {
  id: 7,
  wallet: '0xabcdef0123456789abcdef0123456789abcdef01',
  achievement_id: 4,
  data_hash: '0xeb63454cd7ffa48cf0e34c4d2a0d97a414c5f9b774827f2d55979a464a4dcafc',
};

/** 상태 전이를 기록하는 fake db (행별 상태 — id 키). */
function makeFakeDb({ initialStatus = 'detected', pendingRows = [] } = {}) {
  const rowState = (id) => {
    if (!state.byId.has(id)) {
      state.byId.set(id, { status: initialStatus, tx_hash: null, last_error: null });
    }
    return state.byId.get(id);
  };
  const state = { byId: new Map(), transitions: [] };
  // 편의 접근자: 단일 행 시나리오(ROW.id=7)용
  Object.defineProperties(state, {
    status: { get: () => rowState(ROW.id).status },
    tx_hash: { get: () => rowState(ROW.id).tx_hash },
    last_error: {
      get: () => rowState(ROW.id).last_error,
      set: (v) => { rowState(ROW.id).last_error = v; },
    },
  });
  return {
    state,
    async query(sql, params) {
      if (sql.includes("SET status = 'minting'")) {
        const r = rowState(params[0]);
        if (!['detected', 'failed'].includes(r.status)) return { rows: [] };
        r.status = 'minting';
        state.transitions.push('minting');
        return { rows: [{ id: params[0] }] };
      }
      if (sql.includes("SET status = 'minted'")) {
        const r = rowState(params[0]);
        r.status = 'minted';
        r.tx_hash = params[1];
        r.last_error = null;
        state.transitions.push('minted');
        return { rows: [] };
      }
      if (sql.includes("SET status = 'failed'")) {
        const r = rowState(params[0]);
        r.status = 'failed';
        r.last_error = params[1];
        state.transitions.push('failed');
        return { rows: [] };
      }
      if (sql.includes('SELECT id, wallet, achievement_id, data_hash')) {
        return { rows: pendingRows };
      }
      throw new Error(`fake db: 예상 못한 쿼리 — ${sql.slice(0, 60)}`);
    },
  };
}

let envBackup;
beforeEach(() => { envBackup = process.env.MOCK_MINT; process.env.MOCK_MINT = 'true'; });
afterEach(() => {
  if (envBackup === undefined) delete process.env.MOCK_MINT;
  else process.env.MOCK_MINT = envBackup;
});

test('MOCK 모드: detected → minting → minted, 가짜 tx_hash (0x+64hex) 저장', async () => {
  const db = makeFakeDb();
  const result = await mintDetected(db, ROW);

  assert.strictEqual(result, 'minted');
  assert.deepStrictEqual(db.state.transitions, ['minting', 'minted']);
  assert.match(db.state.tx_hash, /^0x[a-f0-9]{64}$/);
});

test('MOCK 모드: 가짜 tx_hash 는 결정적 — 같은 입력이면 같은 해시 (디버깅 용이)', async () => {
  const db1 = makeFakeDb();
  const db2 = makeFakeDb();
  await mintDetected(db1, ROW);
  await mintDetected(db2, ROW);
  assert.strictEqual(db1.state.tx_hash, db2.state.tx_hash);
});

test('실패 경로: send 가 throw → failed + last_error 보관', async () => {
  const db = makeFakeDb();
  const result = await mintDetected(db, ROW, {
    send: async () => { throw new Error('RPC timeout'); },
  });

  assert.strictEqual(result, 'failed');
  assert.deepStrictEqual(db.state.transitions, ['minting', 'failed']);
  assert.strictEqual(db.state.last_error, 'RPC timeout');
});

test('재시도: failed 행도 minting 선점 가능 → 성공 시 minted + last_error 초기화', async () => {
  const db = makeFakeDb({ initialStatus: 'failed' });
  db.state.last_error = 'RPC timeout';
  const result = await mintDetected(db, ROW);

  assert.strictEqual(result, 'minted');
  assert.strictEqual(db.state.last_error, null);
});

test('선점 가드: 이미 minted/minting 인 행은 건드리지 않음 (null 반환)', async () => {
  for (const status of ['minted', 'minting']) {
    const db = makeFakeDb({ initialStatus: status });
    const result = await mintDetected(db, ROW);
    assert.strictEqual(result, null);
    assert.deepStrictEqual(db.state.transitions, []);
  }
});

test('processPendingMints: 밀린 행들을 순서대로 처리', async () => {
  const db = makeFakeDb({ pendingRows: [{ ...ROW, id: 1 }, { ...ROW, id: 2, achievement_id: 5 }] });
  const results = await processPendingMints(db);
  assert.strictEqual(results.length, 2);
  assert.ok(results.every((r) => r.result === 'minted'));
});

test('실모드(MOCK_MINT 미설정) + env 미비 → failed 로 기록 (인덱서 안 죽음)', async () => {
  delete process.env.MOCK_MINT;
  const backup = {};
  for (const k of ['PRIVATE_KEY', 'ACHIEVEMENTS_NFT_ADDRESS']) {
    backup[k] = process.env[k];
    delete process.env[k];
  }
  try {
    const db = makeFakeDb();
    const result = await mintDetected(db, ROW);
    assert.strictEqual(result, 'failed');
    assert.match(db.state.last_error, /MOCK_MINT=true/);
  } finally {
    for (const [k, v] of Object.entries(backup)) {
      if (v !== undefined) process.env[k] = v;
    }
  }
});

/**
 * ============================================================
 *  PostgreSQL 풀 + 트랜잭션 헬퍼
 * ============================================================
 *
 *  - lazy singleton: 첫 query/withTransaction 호출 시점에 풀 생성.
 *    → 테스트나 import-only 컨텍스트(stats.test.js 등)에서 DB 없이도 모듈 로드 가능.
 *  - withTransaction: BEGIN/COMMIT/ROLLBACK 보일러플레이트 캡슐화.
 *    인덱서의 EnhancementCompleted 핸들러가 attempts UPDATE + user_items UPSERT 를
 *    한 트랜잭션으로 묶을 때 그대로 사용.
 *
 *  pg 자료형 메모
 *  --------------
 *   - NUMERIC(78,0) → JS string (BigInt 처리는 호출부 책임).
 *   - BIGINT       → JS string (정수 안전 범위 초과 가능성). 필요 시 Number 캐스팅은 호출부.
 *   - TIMESTAMPTZ  → JS Date (그대로 JSON.stringify → ISO 문자열).
 *   - INTEGER, SMALLINT, BOOLEAN, VARCHAR → 원시 JS 값.
 * ============================================================
 */

'use strict';

const { Pool } = require('pg');

let pool;

function getPool() {
  if (!pool) {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL not set — check backend/.env');
    }
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    pool.on('error', (err) => {
      // idle client 의 비동기 에러는 process crash 시키지 않도록 캡처만.
      console.error('[db] idle client error:', err);
    });
  }
  return pool;
}

async function query(text, params) {
  return getPool().query(text, params);
}

/**
 * fn(client) 안에서 client.query 로 여러 쿼리를 실행하면
 * 전부 한 트랜잭션으로 묶인다. throw 시 ROLLBACK.
 */
async function withTransaction(fn) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) { /* 이미 끊긴 연결이면 무시 */ }
    throw err;
  } finally {
    client.release();
  }
}

async function close() {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}

module.exports = { getPool, query, withTransaction, close };

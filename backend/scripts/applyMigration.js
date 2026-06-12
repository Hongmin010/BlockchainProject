/**
 * 마이그레이션 SQL 적용 스크립트 (psql 없는 환경용)
 * ----------------------------------------------
 *  실행: node scripts/applyMigration.js db/migrations/003_achievements.sql
 *  .env 의 DATABASE_URL 로 연결해 파일 전체를 한 트랜잭션으로 실행한다.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('../db/pool');

(async () => {
  const rel = process.argv[2];
  if (!rel) {
    console.error('사용법: node scripts/applyMigration.js <마이그레이션 파일 경로>');
    process.exit(1);
  }
  const file = path.resolve(__dirname, '..', rel);
  const sql = fs.readFileSync(file, 'utf8');

  try {
    // pg 는 멀티-스테이트먼트 쿼리를 단일 암묵 트랜잭션으로 실행한다 — 중간 실패 시 전체 롤백.
    await db.query(sql);
    console.log(`[migration] 적용 완료: ${rel}`);
  } catch (err) {
    console.error(`[migration] 실패 (롤백됨): ${err.message}`);
    process.exitCode = 1;
  } finally {
    await db.close();
  }
})();

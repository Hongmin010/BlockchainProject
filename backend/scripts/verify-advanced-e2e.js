/**
 * 고급강화 실데이터 E2E 검증 (일회성 점검 스크립트)
 *  - DB 의 완료된 advanced_attempts 전건에 대해 utils/advancedVerify 로
 *    컨트랙트 산출 로직을 재현, 온체인 기록과 일치하는지 대조한다.
 *  실행: node -r dotenv/config scripts/verify-advanced-e2e.js
 */

'use strict';

const { query, close } = require('../db/pool');
const { verifyAdvancedAttempt, fromDbRow, RESULT_LABEL } = require('../utils/advancedVerify');

(async () => {
  const { rows } = await query(
    "SELECT * FROM advanced_attempts WHERE status='completed' AND result_type IS NOT NULL ORDER BY attempt_id",
  );

  let ok = 0;
  const fails = [];
  const byType = {};
  for (const row of rows) {
    const v = verifyAdvancedAttempt(fromDbRow(row));
    if (v.ok) ok += 1;
    else fails.push({ id: row.attempt_id, mismatches: v.mismatches });
    const label = RESULT_LABEL[row.result_type] ?? row.result_type;
    byType[label] = (byType[label] || 0) + 1;
  }

  console.log(`완료건: ${rows.length} / 검증 OK: ${ok} / FAIL: ${fails.length}`);
  console.log('resultType 분포:', JSON.stringify(byType));
  if (fails.length) console.log('실패 상세(최대 5건):', JSON.stringify(fails.slice(0, 5), null, 1));
  await close();
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });

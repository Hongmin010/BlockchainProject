-- ============================================================
--  Migration 001 — schema v2 → v3 (배포본 일치화)
-- ============================================================
--  적용 시점: 2026-05-25, 홍민 배포본 EnhancementGameVRF 채택 후.
--  대상     : 이미 v2 schema.sql 이 적용된 DB.
--
--  ⚠  본 마이그레이션은 attempts / user_items / probability_history 가
--     모두 비어있다고 가정한다. 인덱서가 한 번이라도 작동하여 데이터가
--     채워졌다면, 먼저 백업하고 truncate 한 뒤 적용한다:
--
--        BEGIN;
--          \! pg_dump --table=attempts --table=user_items --table=probability_history \
--                     "$DATABASE_URL" > /tmp/khu_backup_v2.sql
--          TRUNCATE attempts, user_items, probability_history;
--        COMMIT;
--
--     (이 마이그레이션 안의 DO 블록이 행이 있으면 즉시 abort 한다.)
--
--  적용:
--    psql "$DATABASE_URL" -f db/migrations/001_align_with_deployed_contract.sql
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
--  사전 점검 — 세 테이블 모두 빈 상태여야 한다
-- ------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM attempts LIMIT 1) THEN
    RAISE EXCEPTION 'Aborting migration: attempts is not empty. Backup + truncate first.';
  END IF;
  IF EXISTS (SELECT 1 FROM user_items LIMIT 1) THEN
    RAISE EXCEPTION 'Aborting migration: user_items is not empty. Backup + truncate first.';
  END IF;
  IF EXISTS (SELECT 1 FROM probability_history LIMIT 1) THEN
    RAISE EXCEPTION 'Aborting migration: probability_history is not empty. Backup + truncate first.';
  END IF;
END $$;


-- ------------------------------------------------------------
--  attempts : 컬럼 정렬
-- ------------------------------------------------------------

-- NOT NULL 제약 완화 (요청 이벤트엔 두 값이 없음)
ALTER TABLE attempts ALTER COLUMN before_level         DROP NOT NULL;
ALTER TABLE attempts ALTER COLUMN claimed_success_rate DROP NOT NULL;

-- 어느 이벤트에도 없는 컬럼 제거
ALTER TABLE attempts DROP COLUMN IF EXISTS enhancement_type;

-- randomness_request_id (VARCHAR bytes32) → vrf_request_id (NUMERIC uint256)
DROP INDEX IF EXISTS idx_attempts_vrf_id;
ALTER TABLE attempts RENAME COLUMN randomness_request_id TO vrf_request_id;
-- 자료형 변경: VARCHAR → NUMERIC. 행이 비었으므로 USING NULL 안전.
ALTER TABLE attempts ALTER COLUMN vrf_request_id DROP NOT NULL;
ALTER TABLE attempts ALTER COLUMN vrf_request_id TYPE NUMERIC(78,0) USING NULL;
ALTER TABLE attempts ALTER COLUMN vrf_request_id SET NOT NULL;
CREATE INDEX idx_attempts_vrf_id ON attempts (vrf_request_id);

-- 도착 순서 비결정성: requested_* 메타 NULL 허용
ALTER TABLE attempts ALTER COLUMN requested_tx_hash   DROP NOT NULL;
ALTER TABLE attempts ALTER COLUMN requested_log_index DROP NOT NULL;
ALTER TABLE attempts ALTER COLUMN requested_block     DROP NOT NULL;
ALTER TABLE attempts ALTER COLUMN requested_at        DROP NOT NULL;

-- (requested_tx_hash, requested_log_index) UNIQUE 제거 —
-- 두 컬럼이 NULL 가능해졌고, attempt_id PK 기반 UPSERT 가 멱등성 담당.
ALTER TABLE attempts
  DROP CONSTRAINT IF EXISTS attempts_requested_tx_hash_requested_log_index_key;


-- ------------------------------------------------------------
--  probability_history : 컬럼 추가
-- ------------------------------------------------------------
ALTER TABLE probability_history
  ADD COLUMN IF NOT EXISTS updater          VARCHAR(42);
ALTER TABLE probability_history
  ADD COLUMN IF NOT EXISTS enhancement_type SMALLINT;

-- 빈 테이블이므로 NOT NULL 즉시 부여 가능
ALTER TABLE probability_history ALTER COLUMN updater          SET NOT NULL;
ALTER TABLE probability_history ALTER COLUMN enhancement_type SET NOT NULL;

-- 인덱스 교체 (level 단일 → enhancement_type + level)
DROP INDEX IF EXISTS idx_prob_history_level_block;
CREATE INDEX idx_prob_history_type_level_block
  ON probability_history (enhancement_type, level, block_number DESC);


COMMIT;

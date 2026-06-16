-- ============================================================
--  003 — 업적 NFT 시스템 테이블 (v5)
-- ============================================================
--  이미 v4 스키마가 적용된 DB 에 업적 테이블만 추가한다 (additive only).
--  신규 DB 는 db/schema.sql 만 적용하면 된다 (동일 정의 포함).
--
--  적용:  psql "$DATABASE_URL" -f db/migrations/003_achievements.sql
--  되돌리기: DROP TABLE achievements;
-- ============================================================

CREATE TABLE IF NOT EXISTS achievements (
  id                       BIGSERIAL     PRIMARY KEY,
  wallet                   VARCHAR(42)   NOT NULL,
  achievement_id           SMALLINT      NOT NULL,
  source                   VARCHAR(10)   NOT NULL
                           CHECK (source IN ('onchain', 'offchain')),
  item_id                  NUMERIC(78,0),
  payload                  JSONB,
  data_hash                VARCHAR(66),
  tx_hash                  VARCHAR(66),
  log_index                INTEGER,
  block_number             BIGINT,
  status                   VARCHAR(10)   NOT NULL DEFAULT 'detected'
                           CHECK (status IN ('detected', 'minting', 'minted', 'failed')),
  last_error               TEXT,
  created_at               TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  minted_at                TIMESTAMPTZ,
  updated_at               TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  UNIQUE (wallet, achievement_id)
);

CREATE INDEX IF NOT EXISTS idx_achievements_wallet
  ON achievements (wallet);
CREATE INDEX IF NOT EXISTS idx_achievements_pending_mint
  ON achievements (status) WHERE status IN ('detected', 'failed');

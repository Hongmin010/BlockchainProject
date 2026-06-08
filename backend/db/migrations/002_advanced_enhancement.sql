-- ============================================================
--  002 — 고급강화(상급) 컨트랙트 반영 (v3 → v4)
-- ============================================================
--
--  대상 컨트랙트: AdvancedEnhancementGameVRF (Base Sepolia, 0x4f1c8573…)
--    - 기존 EnhancementGameVRF(0x73e8…)를 baseGame 으로 "참조"만 함 (별도 배포).
--    - base 5강(MAX) 달성 아이템을 5→10강(extraLevel 0~5)으로 상급강화.
--    - 모드: 0=Safe(파괴 X, 실패 시 -1 하락), 1=Risky(실패 시 유지, 파괴 가능).
--    - 결과 5종: 0 FailKeep / 1 Success / 2 SafeDowngrade / 3 Destroyed / 4 Guaranteed.
--    - 연속실패 보장: Safe 2연속 하락 시 다음 Safe 강화 100% 보장
--      (VRF 없이 즉시 확정 → randomValue=0, rollBps=0, vrfRequestId=0).
--
--  변경 요약 (v3 → v4)
--  -------------------
--   1) user_items 확장:
--        + extra_level   (advanced 가 갱신, 0~5)
--        + total_level   (GENERATED = level + extra_level, 자동 합산·저장)
--   2) advanced_attempts 신규 : 상급강화 시도 1건 = 1행 (결과 5종 표현).
--   3) advanced_rate_history 신규 : AdvancedRateUpdated 추적 (차별화 #3 고급강화판).
--
--  자료형/멱등성 컨벤션은 v3(schema.sql)과 동일:
--    uint8→SMALLINT, uint16→INTEGER, uint256→NUMERIC(78,0),
--    address→VARCHAR(42), bool→BOOLEAN. attempt_id PK 기반 UPSERT.
--
--  적용:
--    psql "$DATABASE_URL" -f db/migrations/002_advanced_enhancement.sql
-- ============================================================


-- ------------------------------------------------------------
--  1) user_items 확장 — base(level) + advanced(extra_level)
-- ------------------------------------------------------------
ALTER TABLE user_items
  ADD COLUMN IF NOT EXISTS extra_level SMALLINT NOT NULL DEFAULT 0;

--  total_level = level + extra_level (자동 계산·저장).
--  base<5 인 아이템은 extra_level=0 이므로 total_level=level 로 자연스럽게 일치.
--  ※ extra_level 컬럼이 먼저 존재해야 하므로 별도 ALTER 로 추가.
ALTER TABLE user_items
  ADD COLUMN IF NOT EXISTS total_level SMALLINT
    GENERATED ALWAYS AS (level + extra_level) STORED;

-- 랭킹(T7): 총 레벨 내림차순 조회용
CREATE INDEX IF NOT EXISTS idx_user_items_total_level
  ON user_items (total_level DESC);


-- ------------------------------------------------------------
--  2) advanced_attempts — 상급강화 시도 (VRF 라이프사이클 통합)
-- ------------------------------------------------------------
--  AdvancedEnhancementRequested 로 INSERT(pending),
--  AdvancedEnhancementResult 로 UPDATE(completed).
--  ※ base attempts 와 attempt_id 공간이 분리되므로 별도 테이블.
--  ※ Guaranteed 는 VRF 없이 즉시 → Requested+Result 가 같은 tx 에서 동시 emit,
--     vrf_request_id=0, random_value=0, roll_bps=0.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS advanced_attempts (
  attempt_id               NUMERIC(78,0) PRIMARY KEY,
  user_address             VARCHAR(42)   NOT NULL,
  item_id                  NUMERIC(78,0) NOT NULL,

  -- 0=Safe, 1=Risky
  mode                     SMALLINT      NOT NULL,

  -- 상급 단계 (extraLevel 0~5). before 는 Requested/Result 공통, after 는 Result.
  before_extra_level       SMALLINT,
  after_extra_level        SMALLINT,

  -- 총 단계 (5~10) — 컨트랙트가 base+extra 를 직접 emit.
  before_total_level       SMALLINT,
  after_total_level        SMALLINT,

  -- 결과: 0 FailKeep / 1 Success / 2 SafeDowngrade / 3 Destroyed / 4 Guaranteed (NULL=pending)
  result_type              SMALLINT,

  -- 연속 하락 횟수 (동적확률 검증 입력). Safe 2연속 하락 시 보장 발동.
  before_safe_drop_streak  SMALLINT,
  after_safe_drop_streak   SMALLINT,

  -- 보장 성공 여부 (Safe streak>=2 → TRUE, VRF 없이 즉시 확정)
  guaranteed               BOOLEAN,

  -- 적용된 확률 밴드 (uint16 bp). Safe 는 destroy=0.
  success_rate_bps         INTEGER,
  destroy_rate_bps         INTEGER,

  -- VRF 난수 / roll (재검증 차별화 #2). guaranteed 면 둘 다 0.
  random_value             NUMERIC(78,0),
  roll_bps                 INTEGER,

  -- Chainlink VRF 요청 ID. guaranteed 면 0.
  vrf_request_id           NUMERIC(78,0) NOT NULL,

  status                   VARCHAR(20)   NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending','completed')),

  -- Requested 이벤트 메타 (Result 먼저 도착 시 NULL 가능)
  requested_tx_hash        VARCHAR(66),
  requested_log_index      INTEGER,
  requested_block          BIGINT,
  requested_at             TIMESTAMPTZ,

  -- Result 이벤트 메타 (도착 전엔 NULL)
  completed_tx_hash        VARCHAR(66),
  completed_log_index      INTEGER,
  completed_block          BIGINT,
  completed_at             TIMESTAMPTZ,

  created_at               TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_adv_attempts_user
  ON advanced_attempts (user_address);
-- (user, item, 시간순) — "내 고양이 상급강화 이력"
CREATE INDEX IF NOT EXISTS idx_adv_attempts_user_item_time
  ON advanced_attempts (user_address, item_id, requested_at DESC);
-- 통계 검정 메인 쿼리: 모드·단계별 결과확정된 시도
CREATE INDEX IF NOT EXISTS idx_adv_attempts_stats
  ON advanced_attempts (mode, before_extra_level, status) WHERE status = 'completed';
-- 최근 시도 조회용
CREATE INDEX IF NOT EXISTS idx_adv_attempts_requested_at
  ON advanced_attempts (requested_at DESC);
-- VRF 재검증: vrf_request_id 로 직접 조회
CREATE INDEX IF NOT EXISTS idx_adv_attempts_vrf_id
  ON advanced_attempts (vrf_request_id);


-- ------------------------------------------------------------
--  3) advanced_rate_history — 상급 확률표 변경 이력 (차별화 #3)
-- ------------------------------------------------------------
--  AdvancedRateUpdated 로 INSERT 만. (mode, extraLevel) 2차원 + 파괴율 추적.
--  "운영자 사일런트 너프(특히 파괴율 인상)" 를 상급강화에서도 탐지.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS advanced_rate_history (
  id                       BIGSERIAL     PRIMARY KEY,

  -- 변경 실행 주소 (onlyOwner, lowercase 정규화)
  updater                  VARCHAR(42)   NOT NULL,

  -- 0=Safe, 1=Risky
  mode                     SMALLINT      NOT NULL,

  -- 상급 단계 (extraLevel 0~4 가 변경 대상)
  extra_level              SMALLINT      NOT NULL,

  -- 변경 전/후 성공률 (uint16 bp). 최초 설정 시 old 는 0.
  old_success_rate         INTEGER,
  new_success_rate         INTEGER       NOT NULL,

  -- 변경 전/후 파괴율 (uint16 bp). Safe 는 0.
  old_destroy_rate         INTEGER,
  new_destroy_rate         INTEGER       NOT NULL,

  -- 인덱서가 provider.getBlock(blockNumber).timestamp 로 보강
  on_chain_timestamp       TIMESTAMPTZ   NOT NULL,

  tx_hash                  VARCHAR(66)   NOT NULL,
  log_index                INTEGER       NOT NULL,
  block_number             BIGINT        NOT NULL,
  created_at               TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  -- 멱등성
  UNIQUE (tx_hash, log_index)
);

-- "특정 모드·단계의 확률이 시간순으로 어떻게 바뀌었나"
CREATE INDEX IF NOT EXISTS idx_adv_rate_history_mode_level_block
  ON advanced_rate_history (mode, extra_level, block_number DESC);

-- ============================================================
--  KHU 블록체인 프로젝트 — PostgreSQL 스키마 (v4 — v3 배포본 정렬 + 고급강화 반영)
-- ============================================================
--
--  변경 요약 (v2 → v3)
--  -------------------
--   - 배포본 `EnhancementGameVRF` 와 일치하도록 정렬:
--     * randomness_request_id (VARCHAR bytes32) → vrf_request_id (NUMERIC uint256)
--     * before_level / claimed_success_rate NULL 허용
--       (Requested 이벤트가 두 값을 emit 하지 않음 — Result 도착 시 채움)
--     * attempts.enhancement_type 컬럼 제거 (어느 이벤트에도 없음)
--     * requested_* / completed_* 메타 NULL 허용 (도착 순서 비결정성)
--     * probability_history 에 updater, enhancement_type 컬럼 추가
--     * probability_history.on_chain_timestamp 는 인덱서가 block.timestamp 로 보강
--
--   - 멱등성 패턴 변경: (tx_hash, log_index) UNIQUE 대신 attempt_id PK 기반
--     UPSERT + WHERE status='pending' 가드 사용. probability_history 는
--     (tx_hash, log_index) UNIQUE 유지.
--
--  설계 의도 (v2 사고는 보존)
--  --------------------------
--  1) 컨트랙트 3개 이벤트 + 1개 자동 갱신(user_items) → 4개 테이블 매핑.
--  2) (attempt_id PK) 기반 UPSERT 멱등성. 도착 순서 무관.
--  3) on-chain 자료형 매핑:
--       uint8   → SMALLINT
--       uint16  → INTEGER       (10000 표현 충분, uint32 와 호환)
--       uint32  → INTEGER
--       uint256 → NUMERIC(78,0)
--       address → VARCHAR(42)   (lowercase 정규화)
--       bool    → BOOLEAN
--
--  적용 방법
--  ---------
--    # 신규 DB:
--    psql "$DATABASE_URL" -f db/schema.sql
--
--    # 이미 v2 schema 가 적용된 DB:
--    psql "$DATABASE_URL" -f db/migrations/001_align_with_deployed_contract.sql
-- ============================================================


-- ------------------------------------------------------------
--  attempts : 강화 시도 1건당 1행 (VRF 라이프사이클 통합)
-- ------------------------------------------------------------
--  EnhancementRequested 로 INSERT (or UPSERT), EnhancementResult 로 UPDATE.
--  status: 'pending' → 'completed'.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS attempts (
  -- 컨트랙트 발급 시도 식별자 (uint256, PK + UPSERT conflict target)
  attempt_id              NUMERIC(78, 0) PRIMARY KEY,

  -- 시도 사용자 (lowercase 정규화)
  user_address            VARCHAR(42)    NOT NULL,

  -- 강화 대상 아이템 ID (uint256)
  item_id                 NUMERIC(78, 0) NOT NULL,

  -- 시도 시점 단계 (uint8). EnhancementResult 도착 시 채워짐 (Requested 에는 없음)
  before_level            SMALLINT,

  -- 결과 시점 단계 (uint8). EnhancementResult 도착 전엔 NULL
  after_level             SMALLINT,

  -- 시도 시 적용된 성공 확률 (uint16, basis point 0~10000).
  -- EnhancementResult 도착 시 채워짐 (Requested 에는 없음)
  -- ★ 통계 검정의 1차 입력. probability_history 와 교차 검증 가능.
  claimed_success_rate    INTEGER,

  -- 결과 (NULL = pending, TRUE/FALSE = completed). resultType=1 → TRUE.
  success                 BOOLEAN,

  -- ★ 배포본 일치화: Chainlink VRF Coordinator 발급 요청 ID (uint256)
  vrf_request_id          NUMERIC(78, 0) NOT NULL,

  -- 결과 산출에 쓰인 난수 (uint256). VRF 재검증 차별화 #2 의 핵심 입력
  random_value            NUMERIC(78, 0),

  status                  VARCHAR(20)    NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'completed')),

  -- 요청 이벤트(EnhancementRequested) 블록 메타 (결과 먼저 도착 시 NULL 가능)
  requested_tx_hash       VARCHAR(66),
  requested_log_index     INTEGER,
  requested_block         BIGINT,
  requested_at            TIMESTAMPTZ,

  -- 결과 이벤트(EnhancementResult) 블록 메타 (도착 전엔 NULL)
  completed_tx_hash       VARCHAR(66),
  completed_log_index     INTEGER,
  completed_block         BIGINT,
  completed_at            TIMESTAMPTZ,

  created_at              TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_attempts_user
  ON attempts (user_address);
-- (user, item, 시간순) — "내 아이템 강화 이력" 시나리오 대응
CREATE INDEX IF NOT EXISTS idx_attempts_user_item_time
  ON attempts (user_address, item_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_attempts_before_level
  ON attempts (before_level);
CREATE INDEX IF NOT EXISTS idx_attempts_status
  ON attempts (status);
-- 통계 검정 메인 쿼리: "단계별 + 결과확정된 시도들"
CREATE INDEX IF NOT EXISTS idx_attempts_stats
  ON attempts (before_level, status) WHERE status = 'completed';
-- 최근 시도 조회용
CREATE INDEX IF NOT EXISTS idx_attempts_requested_at
  ON attempts (requested_at DESC);
-- VRF 재검증: vrf_request_id 로 직접 조회
CREATE INDEX IF NOT EXISTS idx_attempts_vrf_id
  ON attempts (vrf_request_id);


-- ------------------------------------------------------------
--  user_items : (user, item) 현재 상태 (★ 이벤트 없이 자동 갱신)
-- ------------------------------------------------------------
--  컨트랙트가 UserItemStateUpdated 를 emit 하지 않으므로,
--  인덱서가 EnhancementResult 처리 시 attempts UPSERT 와 같은 트랜잭션 안에서 UPSERT.
--  자세한 사고: docs/design_decisions.md 결정 1.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_items (
  user_address            VARCHAR(42)    NOT NULL,
  item_id                 NUMERIC(78, 0) NOT NULL,

  -- 갱신 후 단계 (uint8) — base 강화 단계 0~5
  level                   SMALLINT       NOT NULL,

  -- 상급강화 단계 (extraLevel 0~5). AdvancedEnhancement 가 갱신. (v4)
  extra_level             SMALLINT       NOT NULL DEFAULT 0,

  -- 총 단계 = base + extra (5~10). 자동 계산·저장. (v4)
  total_level             SMALLINT       GENERATED ALWAYS AS (level + extra_level) STORED,

  -- 누적 강화 시도 횟수 (백엔드가 +1)
  total_attempts          NUMERIC(78, 0) NOT NULL,

  -- 가장 최근 갱신 메타 (감사용) — EnhancementResult 이벤트 메타와 일치
  last_tx_hash            VARCHAR(66)    NOT NULL,
  last_log_index          INTEGER        NOT NULL,
  last_block              BIGINT         NOT NULL,
  last_updated_at         TIMESTAMPTZ    NOT NULL,

  created_at              TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ    NOT NULL DEFAULT NOW(),

  PRIMARY KEY (user_address, item_id)
);

CREATE INDEX IF NOT EXISTS idx_user_items_item
  ON user_items (item_id);
-- 랭킹(T7): 총 레벨 내림차순 (v4)
CREATE INDEX IF NOT EXISTS idx_user_items_total_level
  ON user_items (total_level DESC);


-- ------------------------------------------------------------
--  probability_history : 확률표 변경 이력 (★ 차별화 #3)
-- ------------------------------------------------------------
--  ProbabilityTableUpdated 이벤트로 INSERT 만 일어남.
--  배포본은 (단계, 강화종류) 2 차원 확률표를 운영하므로 enhancement_type 도 보존.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS probability_history (
  id                      BIGSERIAL      PRIMARY KEY,

  -- 변경 실행 주소 (onlyOwner, lowercase 정규화)
  updater                 VARCHAR(42)    NOT NULL,

  -- 변경된 단계 (uint8)
  level                   SMALLINT       NOT NULL,

  -- 강화 종류 (uint8)
  enhancement_type        SMALLINT       NOT NULL,

  -- 변경 전 확률 (uint16 bp). 최초 설정 시 0.
  old_success_rate        INTEGER,

  -- 변경 후 확률 (uint16 bp)
  new_success_rate        INTEGER        NOT NULL,

  -- 인덱서가 provider.getBlock(blockNumber).timestamp 로 보강
  on_chain_timestamp      TIMESTAMPTZ    NOT NULL,

  tx_hash                 VARCHAR(66)    NOT NULL,
  log_index               INTEGER        NOT NULL,
  block_number            BIGINT         NOT NULL,

  created_at              TIMESTAMPTZ    NOT NULL DEFAULT NOW(),

  -- 멱등성
  UNIQUE (tx_hash, log_index)
);

-- "특정 강화종류·단계의 확률이 시간순으로 어떻게 바뀌었나"
CREATE INDEX IF NOT EXISTS idx_prob_history_type_level_block
  ON probability_history (enhancement_type, level, block_number DESC);


-- ------------------------------------------------------------
--  indexer_cursor : 인덱서 진행 상태 (싱글톤)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS indexer_cursor (
  id                      VARCHAR(32)    PRIMARY KEY DEFAULT 'main',
  last_block              BIGINT         NOT NULL DEFAULT 0,
  updated_at              TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

INSERT INTO indexer_cursor (id, last_block)
VALUES ('main', 0)
ON CONFLICT (id) DO NOTHING;


-- ============================================================
--  v4 — 고급강화(상급) : AdvancedEnhancementGameVRF (0x4f1c…)
--  base(0x73e8) 를 baseGame 으로 참조하는 별도 컨트랙트. base 5강 → 5~10강.
--  (기존 DB 는 db/migrations/002_advanced_enhancement.sql 로 적용)
-- ============================================================

-- ------------------------------------------------------------
--  advanced_attempts : 상급강화 시도 (VRF 라이프사이클 통합)
-- ------------------------------------------------------------
--  AdvancedEnhancementRequested → INSERT(pending),
--  AdvancedEnhancementResult    → UPDATE(completed).
--  결과 5종(0 FailKeep/1 Success/2 SafeDowngrade/3 Destroyed/4 Guaranteed)
--  이라 base attempts(success BOOLEAN) 와 별도 테이블.
--  Guaranteed 는 VRF 없이 즉시 → vrf_request_id=0, random_value=0, roll_bps=0.
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
CREATE INDEX IF NOT EXISTS idx_adv_attempts_user_item_time
  ON advanced_attempts (user_address, item_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_adv_attempts_stats
  ON advanced_attempts (mode, before_extra_level, status) WHERE status = 'completed';
CREATE INDEX IF NOT EXISTS idx_adv_attempts_requested_at
  ON advanced_attempts (requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_adv_attempts_vrf_id
  ON advanced_attempts (vrf_request_id);


-- ------------------------------------------------------------
--  advanced_rate_history : 상급 확률표 변경 이력 (차별화 #3)
-- ------------------------------------------------------------
--  AdvancedRateUpdated 로 INSERT 만. (mode, extraLevel) 2차원 + 파괴율 추적.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS advanced_rate_history (
  id                       BIGSERIAL     PRIMARY KEY,
  updater                  VARCHAR(42)   NOT NULL,
  mode                     SMALLINT      NOT NULL,
  extra_level              SMALLINT      NOT NULL,

  old_success_rate         INTEGER,
  new_success_rate         INTEGER       NOT NULL,
  old_destroy_rate         INTEGER,
  new_destroy_rate         INTEGER       NOT NULL,

  on_chain_timestamp       TIMESTAMPTZ   NOT NULL,
  tx_hash                  VARCHAR(66)   NOT NULL,
  log_index                INTEGER       NOT NULL,
  block_number             BIGINT        NOT NULL,
  created_at               TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  UNIQUE (tx_hash, log_index)
);

CREATE INDEX IF NOT EXISTS idx_adv_rate_history_mode_level_block
  ON advanced_rate_history (mode, extra_level, block_number DESC);

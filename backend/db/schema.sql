-- ============================================================
--  KHU 블록체인 프로젝트 — PostgreSQL 스키마 (v1.0 확정본)
-- ============================================================
--
--  설계 의도
--  ---------
--  1) docs/events.md 의 6개 이벤트를 1:1 로 매핑하는 5개 테이블.
--  2) 모든 이벤트 처리는 (tx_hash, log_index) 기반 멱등성을 보장한다.
--  3) on-chain 자료형은 다음 규칙으로 매핑한다.
--       uint8   → SMALLINT
--       uint32  → INTEGER
--       uint256 → NUMERIC(78,0)        -- 2^256-1 은 78자리
--       bytes32 → VARCHAR(66)          -- "0x" + 64 hex chars
--       address → VARCHAR(42)          -- "0x" + 40 hex chars (lowercase 정규화)
--       bool    → BOOLEAN
--
--  vrf_requests 를 별도 테이블로 둔 이유 (★ 설계 결정)
--  --------------------------------------------------
--  attempts 와 1:1 관계이지만 별도 테이블로 분리했다.
--    (a) RandomnessRequested / RandomnessFulfilled 두 이벤트의 도착이
--        EnhancementAttempted/Result 와 비동기적으로 일어나기 때문에,
--        각 이벤트 핸들러가 "자기 테이블만" 건드리도록 두면
--        인덱서 구현이 단순해지고 race-condition 가능성이 줄어든다.
--    (b) VRF 라이프사이클(요청 → 충족) 자체를 추적/관측 가능해진다.
--        예) 평균 VRF 응답 지연 시간 통계.
--    (c) 향후 retry 로직 도입 시 1:N 으로 확장하기 쉽다.
--
--  적용 방법
--  ---------
--    psql "$DATABASE_URL" -f db/schema.sql
-- ============================================================


-- ------------------------------------------------------------
--  attempts : 강화 시도 1건당 1행
-- ------------------------------------------------------------
--  EnhancementAttempted 로 INSERT, EnhancementResult 로 UPDATE.
--  status 컬럼으로 두 이벤트 사이의 lifecycle 을 추적한다.
--    'pending'   : 요청은 받았으나 결과 미도착
--    'fulfilled' : 결과 이벤트 도착 완료
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS attempts (
  -- 컨트랙트가 발급하는 강화 시도 식별자 (uint256)
  -- v0의 request_id 에서 attemptId 로 명칭 변경 — VRF의 requestId 와 충돌 방지
  attempt_id              NUMERIC(78, 0) PRIMARY KEY,

  -- 시도한 사용자 지갑 주소 (lowercase 로 정규화하여 저장)
  user_address            VARCHAR(42)    NOT NULL,

  -- 강화 대상 아이템 ID (uint256)
  item_id                 NUMERIC(78, 0) NOT NULL,

  -- 강화 종류 (uint8). 일반/특수/이벤트 등 운영사 정의
  enhancement_type        SMALLINT       NOT NULL,

  -- 시도 시점 단계 (uint8)
  before_level            SMALLINT       NOT NULL,

  -- 결과 시점 단계 (uint8). EnhancementResult 도착 전엔 NULL
  after_level             SMALLINT,

  -- 시도 시점에 컨트랙트가 광고/적용한 성공 확률 (uint32, basis point: 0~10000)
  -- ★ 통계 검정의 1차 입력. probability_history 와 교차 검증 가능.
  claimed_success_rate    INTEGER        NOT NULL,

  -- 결과 (NULL = pending, TRUE/FALSE = fulfilled)
  success                 BOOLEAN,

  -- 결과 산출에 쓰인 난수 (uint256). EnhancementResult.randomValue.
  -- vrf_requests.random_value 와 일치해야 함 (VRF 재검증 차별화 포인트 #2).
  random_value            NUMERIC(78, 0),

  -- 라이프사이클 상태
  status                  VARCHAR(20)    NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'fulfilled')),

  -- 요청 이벤트(EnhancementAttempted) 블록 메타
  attempted_tx_hash       VARCHAR(66)    NOT NULL,
  attempted_log_index     INTEGER        NOT NULL,
  attempted_block         BIGINT         NOT NULL,
  attempted_at            TIMESTAMPTZ    NOT NULL,

  -- 결과 이벤트(EnhancementResult) 블록 메타 (도착 전엔 NULL)
  fulfilled_tx_hash       VARCHAR(66),
  fulfilled_log_index     INTEGER,
  fulfilled_block         BIGINT,
  fulfilled_at            TIMESTAMPTZ,

  created_at              TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ    NOT NULL DEFAULT NOW(),

  -- 동일 EnhancementAttempted 이벤트 중복 수신 방지
  UNIQUE (attempted_tx_hash, attempted_log_index)
);

-- 인덱스: 자주 쓰일 조회 패턴에 맞춤
CREATE INDEX IF NOT EXISTS idx_attempts_user
  ON attempts (user_address);
CREATE INDEX IF NOT EXISTS idx_attempts_before_level
  ON attempts (before_level);
CREATE INDEX IF NOT EXISTS idx_attempts_status
  ON attempts (status);
CREATE INDEX IF NOT EXISTS idx_attempts_enhancement_type
  ON attempts (enhancement_type);
-- 통계 검정 메인 쿼리: "단계별 + 결과확정된 시도들"
CREATE INDEX IF NOT EXISTS idx_attempts_stats
  ON attempts (before_level, status) WHERE status = 'fulfilled';
-- 최근 시도 조회용 (정렬 비용 절감)
CREATE INDEX IF NOT EXISTS idx_attempts_attempted_at
  ON attempts (attempted_at DESC);


-- ------------------------------------------------------------
--  vrf_requests : Chainlink VRF 라이프사이클
-- ------------------------------------------------------------
--  RandomnessRequested 로 INSERT, RandomnessFulfilled 로 UPDATE.
--  attempts 와 1:1 이지만 분리해 보관 (위 헤더 주석의 설계 근거 참고).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vrf_requests (
  -- Chainlink VRF Coordinator 가 발급한 요청 ID (bytes32)
  randomness_request_id   VARCHAR(66)    PRIMARY KEY,

  -- 어떤 강화 시도에 대한 VRF인지 (FK 는 두지 않음 — 인덱서가
  -- 이벤트 도착 순서를 보장하지 않으므로, attempts 행보다 먼저
  -- vrf_requests 행이 들어올 수 있음)
  attempt_id              NUMERIC(78, 0) NOT NULL,

  -- VRF 를 요청한 컨트랙트 호출자 (= 강화 시도자)
  user_address            VARCHAR(42)    NOT NULL,

  -- VRF 가 반환한 난수 (uint256). 도착 전엔 NULL.
  random_value            NUMERIC(78, 0),

  status                  VARCHAR(20)    NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'fulfilled')),

  -- RandomnessRequested 블록 메타
  requested_tx_hash       VARCHAR(66)    NOT NULL,
  requested_log_index     INTEGER        NOT NULL,
  requested_block         BIGINT         NOT NULL,
  requested_at            TIMESTAMPTZ    NOT NULL,

  -- RandomnessFulfilled 블록 메타
  fulfilled_tx_hash       VARCHAR(66),
  fulfilled_log_index     INTEGER,
  fulfilled_block         BIGINT,
  fulfilled_at            TIMESTAMPTZ,

  created_at              TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ    NOT NULL DEFAULT NOW(),

  -- 중복 수신 방지
  UNIQUE (requested_tx_hash, requested_log_index)
);

CREATE INDEX IF NOT EXISTS idx_vrf_attempt
  ON vrf_requests (attempt_id);
CREATE INDEX IF NOT EXISTS idx_vrf_status
  ON vrf_requests (status);


-- ------------------------------------------------------------
--  user_items : (user, item) 별 현재 상태
-- ------------------------------------------------------------
--  UserItemStateUpdated 이벤트로 UPSERT.
--  강화 외 경로(거래, 합성)로도 갱신될 수 있으므로 attempts 와 별개 관리.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_items (
  user_address            VARCHAR(42)    NOT NULL,
  item_id                 NUMERIC(78, 0) NOT NULL,

  -- 현재(갱신 후) 단계 (uint8)
  level                   SMALLINT       NOT NULL,

  -- 해당 (user, item) 누적 강화 시도 횟수 (uint256 — 이벤트 명세 그대로)
  total_attempts          NUMERIC(78, 0) NOT NULL,

  -- 가장 최근 갱신 메타 (감사용)
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


-- ------------------------------------------------------------
--  probability_history : 확률표 변경 이력 (★ 차별화 포인트 #3)
-- ------------------------------------------------------------
--  ProbabilityTableUpdated 이벤트로 INSERT 만 일어남 (UPDATE 없음).
--  "언제 / 어느 단계의 / 얼마에서 얼마로 / 어느 트랜잭션에서" 변경됐는지
--  영구 보존하여 운영사의 사일런트 너프(silent nerf) 행위를 감시한다.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS probability_history (
  id                      BIGSERIAL      PRIMARY KEY,

  -- 변경된 단계 (uint8)
  level                   SMALLINT       NOT NULL,

  -- 변경 전 확률 (uint32, basis point). 최초 설정 시 0 또는 NULL.
  old_success_rate        INTEGER,

  -- 변경 후 확률 (uint32, basis point)
  new_success_rate        INTEGER        NOT NULL,

  -- 컨트랙트가 발행한 timestamp (block.timestamp, uint256)
  on_chain_timestamp      TIMESTAMPTZ    NOT NULL,

  -- 블록 메타
  tx_hash                 VARCHAR(66)    NOT NULL,
  log_index               INTEGER        NOT NULL,
  block_number            BIGINT         NOT NULL,

  created_at              TIMESTAMPTZ    NOT NULL DEFAULT NOW(),

  -- 멱등성 보장
  UNIQUE (tx_hash, log_index)
);

-- "특정 단계의 확률이 시간순으로 어떻게 바뀌었나" 가 가장 빈번한 쿼리
CREATE INDEX IF NOT EXISTS idx_prob_history_level_block
  ON probability_history (level, block_number DESC);


-- ------------------------------------------------------------
--  indexer_cursor : 인덱서 진행 상태 (싱글톤)
-- ------------------------------------------------------------
--  인덱서가 마지막으로 처리 완료한 블록 번호.
--  재시작 시 이 값+1 부터 이어서 처리한다.
--  reorg 버퍼(5블록)를 고려해 "확정된 블록"만 last_block 에 기록.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS indexer_cursor (
  id                      VARCHAR(32)    PRIMARY KEY DEFAULT 'main',
  last_block              BIGINT         NOT NULL DEFAULT 0,
  -- 인덱서 헬스체크용 (마지막 살아있다고 보고한 시각)
  updated_at              TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

INSERT INTO indexer_cursor (id, last_block)
VALUES ('main', 0)
ON CONFLICT (id) DO NOTHING;

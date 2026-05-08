-- ============================================================
--  KHU 블록체인 프로젝트 — PostgreSQL 스키마 (v2.0 단순화 확정본)
-- ============================================================
--
--  변경 요약 (v1 → v2)
--  -------------------
--   - 테이블 5개 → 4개로 축소.
--   - vrf_requests 테이블 제거 → attempts 에 randomness_request_id 컬럼 흡수.
--   - attempts.status enum: 'pending' / 'fulfilled' → 'pending' / 'completed'.
--     (이벤트가 EnhancementResult → EnhancementCompleted 로 통합된 데 맞춤)
--   - user_items 테이블은 유지하되, 컨트랙트의 UserItemStateUpdated 이벤트
--     없이 인덱서가 EnhancementCompleted 처리 시 자동 UPSERT 한다.
--     (★ 핵심 설계 결정 — docs/design_decisions.md 결정 1 참고)
--
--  설계 의도
--  ---------
--  1) docs/events.md 의 3개 이벤트 + 1개 자동갱신을 4개 테이블로 매핑한다.
--       EnhancementRequested      → attempts INSERT
--       EnhancementCompleted      → attempts UPDATE  +  user_items UPSERT (한 트랜잭션)
--       ProbabilityTableUpdated   → probability_history INSERT
--  2) 모든 이벤트 처리는 (tx_hash, log_index) 기반 멱등성을 보장한다.
--  3) on-chain 자료형은 다음 규칙으로 매핑한다.
--       uint8   → SMALLINT
--       uint32  → INTEGER
--       uint256 → NUMERIC(78,0)        -- 2^256-1 은 78자리
--       bytes32 → VARCHAR(66)          -- "0x" + 64 hex chars
--       address → VARCHAR(42)          -- "0x" + 40 hex chars (lowercase 정규화)
--       bool    → BOOLEAN
--
--  vrf_requests 를 합친 이유 (★ V2 설계 결정)
--  -------------------------------------------
--   - V1에선 attempts 와 1:1 관계인데도 "VRF 라이프사이클 관측"을 위해
--     별도 테이블을 두었다.
--   - 그러나 V2에선 컨트랙트가 EnhancementRequested / EnhancementCompleted
--     두 이벤트로 강화 + VRF 라이프사이클을 통합 발행하므로,
--     백엔드도 한 행 안에서 라이프사이클을 추적하면 된다.
--   - 1:1 관계인 두 테이블을 분리하던 명분이 사라졌다 → 흡수.
--
--  적용 방법
--  ---------
--    psql "$DATABASE_URL" -f db/schema.sql
-- ============================================================


-- ------------------------------------------------------------
--  attempts : 강화 시도 1건당 1행 (★ V2에서 VRF 라이프사이클 흡수)
-- ------------------------------------------------------------
--  EnhancementRequested 로 INSERT, EnhancementCompleted 로 UPDATE.
--  status 컬럼으로 두 이벤트 사이의 lifecycle 을 추적한다.
--    'pending'   : 요청은 받았으나 결과 미도착
--    'completed' : 결과 이벤트 도착 완료 (V1의 'fulfilled' 에서 명칭 변경)
--
--  ★ V2 변경점
--    - randomness_request_id 컬럼 신설 (V1에선 vrf_requests 테이블에 있던 것)
--    - 같은 행 안에서 강화 + VRF 라이프사이클을 모두 추적
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS attempts (
  -- 컨트랙트가 발급하는 강화 시도 식별자 (uint256)
  attempt_id              NUMERIC(78, 0) PRIMARY KEY,

  -- 시도한 사용자 지갑 주소 (lowercase 로 정규화하여 저장)
  user_address            VARCHAR(42)    NOT NULL,

  -- 강화 대상 아이템 ID (uint256)
  item_id                 NUMERIC(78, 0) NOT NULL,

  -- 강화 종류 (uint8). 일반/특수/이벤트 등 운영사 정의
  enhancement_type        SMALLINT       NOT NULL,

  -- 시도 시점 단계 (uint8)
  before_level            SMALLINT       NOT NULL,

  -- 결과 시점 단계 (uint8). EnhancementCompleted 도착 전엔 NULL
  after_level             SMALLINT,

  -- 시도 시점에 컨트랙트가 광고/적용한 성공 확률 (uint32, basis point: 0~10000)
  -- ★ 통계 검정의 1차 입력. probability_history 와 교차 검증 가능.
  claimed_success_rate    INTEGER        NOT NULL,

  -- 결과 (NULL = pending, TRUE/FALSE = completed)
  success                 BOOLEAN,

  -- ★ V2 신설: Chainlink VRF Coordinator 발급 요청 ID (bytes32)
  --   EnhancementRequested.randomnessRequestId 시점에 INSERT 와 함께 채워짐.
  --   EnhancementCompleted 도 같은 값을 재발행하므로 일치 검증에 사용.
  randomness_request_id   VARCHAR(66)    NOT NULL,

  -- 결과 산출에 쓰인 난수 (uint256). EnhancementCompleted.randomValue.
  -- VRF 재검증 차별화 포인트 #2의 핵심 입력.
  random_value            NUMERIC(78, 0),

  -- 라이프사이클 상태
  status                  VARCHAR(20)    NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'completed')),

  -- 요청 이벤트(EnhancementRequested) 블록 메타
  requested_tx_hash       VARCHAR(66)    NOT NULL,
  requested_log_index     INTEGER        NOT NULL,
  requested_block         BIGINT         NOT NULL,
  requested_at            TIMESTAMPTZ    NOT NULL,

  -- 결과 이벤트(EnhancementCompleted) 블록 메타 (도착 전엔 NULL)
  completed_tx_hash       VARCHAR(66),
  completed_log_index     INTEGER,
  completed_block         BIGINT,
  completed_at            TIMESTAMPTZ,

  created_at              TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ    NOT NULL DEFAULT NOW(),

  -- 동일 EnhancementRequested 이벤트 중복 수신 방지 (멱등성)
  UNIQUE (requested_tx_hash, requested_log_index)
);

-- 인덱스: 자주 쓰일 조회 패턴에 맞춤
CREATE INDEX IF NOT EXISTS idx_attempts_user
  ON attempts (user_address);
-- (user, item, 시간순 내림차순) — "특정 사용자의 특정 아이템 시도 이력" 조회에 최적
-- ★ V2 신설 인덱스: user_items 자동 갱신 + UI 의 "내 아이템 강화 이력" 시나리오 대응
CREATE INDEX IF NOT EXISTS idx_attempts_user_item_time
  ON attempts (user_address, item_id, requested_at DESC);

CREATE INDEX IF NOT EXISTS idx_attempts_before_level
  ON attempts (before_level);
CREATE INDEX IF NOT EXISTS idx_attempts_status
  ON attempts (status);
CREATE INDEX IF NOT EXISTS idx_attempts_enhancement_type
  ON attempts (enhancement_type);
-- 통계 검정 메인 쿼리: "단계별 + 결과확정된 시도들"
CREATE INDEX IF NOT EXISTS idx_attempts_stats
  ON attempts (before_level, status) WHERE status = 'completed';
-- 최근 시도 조회용 (정렬 비용 절감)
CREATE INDEX IF NOT EXISTS idx_attempts_requested_at
  ON attempts (requested_at DESC);
-- VRF 재검증: randomness_request_id 로 직접 조회 가능하게
CREATE INDEX IF NOT EXISTS idx_attempts_vrf_id
  ON attempts (randomness_request_id);


-- ------------------------------------------------------------
--  user_items : (user, item) 별 현재 상태 (★ 이벤트 없이 자동 갱신)
-- ------------------------------------------------------------
--  V1: UserItemStateUpdated 이벤트로 UPSERT 했던 테이블.
--  V2: 컨트랙트가 해당 이벤트를 emit하지 않는다.
--      대신 인덱서가 EnhancementCompleted 핸들러 내부에서
--      attempts UPDATE 와 같은 DB 트랜잭션으로 UPSERT 한다.
--
--  근거 (docs/design_decisions.md 결정 1):
--   - 우리 시스템에 강화 외 아이템 상태 변경 경로 없음
--   - EnhancementCompleted.afterLevel 만 알면 갱신 가능
--   - 컨트랙트 가스비 절감 + DB 트랜잭션으로 무결성 강화
--   - "이벤트 = 사용자 비용, 테이블 = 운영자 비용" 분리 사고
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_items (
  user_address            VARCHAR(42)    NOT NULL,
  item_id                 NUMERIC(78, 0) NOT NULL,

  -- 현재(갱신 후) 단계 (uint8)
  level                   SMALLINT       NOT NULL,

  -- 해당 (user, item) 누적 강화 시도 횟수
  -- (V1에선 컨트랙트가 발행한 totalAttempts 값을 그대로 받았으나,
  --  V2에선 백엔드가 EnhancementCompleted 처리 시 +1 증가시킨다.)
  total_attempts          NUMERIC(78, 0) NOT NULL,

  -- 가장 최근 갱신 메타 (감사용) — EnhancementCompleted 이벤트 메타와 일치
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
--
--  V2에서도 이 테이블/이벤트는 통합 대상이 아니다 — 시도 이벤트와는
--  라이프사이클이 다른 (운영자 행위) 신호이기 때문.
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

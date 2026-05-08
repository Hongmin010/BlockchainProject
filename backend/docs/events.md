# 컨트랙트 이벤트 명세 (v2.0 — 단순화 확정본)

> 본 문서는 **컨트랙트 팀과 백엔드 팀이 합의 완료한** 온체인 이벤트의 최종 시그니처와 의미를 정리한다.
> 인덱서(`indexer/indexer.js`)는 이 명세에 따라 이벤트를 디코딩하고 DB(`db/schema.sql`)에 저장한다.
> 변경 시 양 팀의 합의가 필요하다.

---

## 변경 이력 (v1 → v2)

v1에서 6개였던 이벤트를 **3개로 통합**했다. 단순화의 핵심 사고는 다음과 같다.

1. **VRF 라이프사이클은 우리 서비스의 본질이 아니다.**
   사용자 관점에서 의미 있는 사건은 "강화를 시도했다 / 결과가 나왔다" 두 단계뿐이다.
   "VRF에 요청을 송신했다 / VRF로부터 콜백을 받았다"는 내부 구현 디테일이며,
   이를 별도 이벤트로 발행하면 가스만 더 들고 사용자 정보량은 늘지 않는다.
   → **요청 단계 통합** (`EnhancementAttempted` + `RandomnessRequested` → `EnhancementRequested`)
   → **결과 단계 통합** (`EnhancementResult` + `RandomnessFulfilled` → `EnhancementCompleted`)

2. **`UserItemStateUpdated`는 100% 추론 가능한 정보다.**
   우리 시스템에는 강화 외에 아이템 상태를 바꾸는 경로가 없다.
   따라서 `EnhancementCompleted.afterLevel` 만 알면 사용자 아이템 상태는 결정된다.
   → 컨트랙트는 이 이벤트를 emit하지 않는다 (가스 절감).
   → 백엔드 인덱서가 `EnhancementCompleted` 처리 시 같은 DB 트랜잭션 안에서
     `attempts` UPDATE 와 `user_items` UPSERT 를 동시에 수행한다.
   → 자세한 근거는 [`design_decisions.md`](./design_decisions.md) 결정 1 참고.

3. **`ProbabilityTableUpdated` 는 그대로 유지한다.**
   이 이벤트는 사용자 시도가 아닌 **운영자의 확률표 변경**을 추적하는 채널이며,
   감사(audit) 목적의 영구 기록이라는 차별화 포인트(#3)의 근간이다.

### V1 → V2 매핑 표

| V1 이벤트 | V2 이벤트 | 처리 |
| --- | --- | --- |
| `EnhancementAttempted` | **`EnhancementRequested`** | 통합 (요청 + VRF 송신을 한 이벤트로) |
| `RandomnessRequested` | **`EnhancementRequested`** | 통합 (위와 동일) — `randomnessRequestId` 필드로 흡수 |
| `EnhancementResult` | **`EnhancementCompleted`** | 통합 (결과 + VRF 응답을 한 이벤트로) |
| `RandomnessFulfilled` | **`EnhancementCompleted`** | 통합 (위와 동일) — `randomValue` 필드로 흡수 |
| `UserItemStateUpdated` | **(제거)** | 컨트랙트에서 emit하지 않음 — 백엔드가 자동 갱신 |
| `ProbabilityTableUpdated` | `ProbabilityTableUpdated` | 변경 없음 (유지) |

### V1 → V2 매핑 표 (테이블)

| V1 테이블 | V2 테이블 | 처리 |
| --- | --- | --- |
| `attempts` | `attempts` (확장) | `randomness_request_id` 컬럼 추가, status `pending/completed` |
| `vrf_requests` | **(제거)** | `attempts` 로 흡수 (1:1 관계였음) |
| `user_items` | `user_items` | 동일 (★ 단, 이벤트 없이 백엔드가 자동 UPSERT) |
| `probability_history` | `probability_history` | 변경 없음 |
| `indexer_cursor` | `indexer_cursor` | 변경 없음 |

### 가스 절감 효과 (개략)

- 강화 1회당 emit 이벤트 수: **4개 → 2개** (`Requested` + `Completed`).
- 추가로 `UserItemStateUpdated` 1회 emit 제거.
- LOG 오피코드와 토픽 인코딩 비용을 합쳐 **강화 1회당 약 1,600 gas (~13%)** 절감으로 추정.
- 정확한 수치는 본구현 단계에서 컨트랙트 팀(이주안)과 함께 가스 측정 후 확정.

---

## 인덱싱 대상 이벤트 (총 3개)

### (1) `EnhancementRequested` — 강화 시도 요청 (VRF 송신 통합)

사용자가 강화 시도를 요청한 시점에 발행된다.
**컨트랙트는 이 시점에 VRF 요청도 함께 송신**하므로,
VRF Coordinator 가 발급한 `randomnessRequestId` 도 같은 이벤트에 포함한다.

이 시점에 컨트랙트가 적용한 **표기 확률(`successRate`)** 도 함께 기록되므로,
후일 "표기 확률 vs 실측" 통계 검증의 1차 근거가 된다.

```solidity
event EnhancementRequested(
    uint256 indexed attemptId,             // 강화 시도 식별자 (컨트랙트 발급, 단조 증가)
    address indexed user,                  // 시도한 사용자 지갑
    uint256 indexed itemId,                // 강화 대상 아이템 ID (NFT tokenId)
    uint8           beforeLevel,           // 강화 전 단계 (0~255)
    uint8           enhancementType,       // 강화 종류 (일반/특수/이벤트 등 256개까지)
    uint32          successRate,           // 적용된 성공 확률 (basis point: 0~10000 = 0~100%)
    bytes32         randomnessRequestId    // VRF Coordinator 발급 요청 ID
);
```

**indexed 의도**:
- `attemptId` — 단일 시도 조회의 핵심 키, 항상 indexed.
- `user` — 사용자별 이력 필터링이 자주 일어남.
- `itemId` — 아이템별 통계(어떤 아이템이 자주 강화되는가)에 활용.

**자료형 근거**:
- `successRate` `uint32` — basis point(0~10000) 표현에는 14비트면 충분하지만, EVM 워드 패킹 단위가 32비트이므로 `uint32`가 효율적.
- `enhancementType` `uint8` — 강화 모드 가짓수는 현실적으로 수십 개 이내. 다른 `uint8` 필드(`beforeLevel`)와 한 슬롯에 패킹 가능.
- `randomnessRequestId` `bytes32` — Chainlink VRF v2 표준 타입. 우리 시스템의 `attemptId`(uint256)와 명시적으로 분리.

**DB 매핑** → `attempts` 테이블에 신규 행 INSERT (status='pending').
이 시점에 `randomness_request_id` 컬럼이 채워진다.

---

### (2) `EnhancementCompleted` — 강화 결과 확정 (VRF 응답 통합)

VRF 난수가 도착하고 강화 성패가 확정될 때 발행된다.
**이 이벤트의 `randomValue`가 컨트랙트의 결과 산출(`success`)에 실제로 쓰인 난수**이며,
백엔드는 이 난수를 off-chain 에서 다시 적용하여 결과를 재계산하고
`success` 와 일치하는지 검증한다 — 이것이 차별화 포인트 #2(VRF 재검증).

```solidity
event EnhancementCompleted(
    uint256 indexed attemptId,             // EnhancementRequested.attemptId 와 동일
    address indexed user,
    uint256 indexed itemId,
    bytes32         randomnessRequestId,   // EnhancementRequested.randomnessRequestId 와 동일 (감사 편의)
    uint256         randomValue,           // 결과 산출에 쓰인 VRF 난수 (256bit)
    uint8           beforeLevel,           // 시도 시점 단계 (감사 편의를 위해 재발행)
    uint8           afterLevel,            // 확정된 최종 단계 (성공 시 +1, 실패 시 유지/하락 등)
    bool            success,               // true=성공, false=실패
    uint32          successRate            // 시도 시점 적용된 확률 (재발행 — 검증 편의)
);
```

**indexed 의도**: `attemptId`(요청과 매칭), `user`(이력), `itemId`(아이템별 분석) 셋 모두 필터 사용 빈도 높음.

**필드 중복(`beforeLevel`, `successRate`, `randomnessRequestId`)에 대한 메모**:
요청 이벤트와 결과 이벤트가 다른 블록에 있을 수 있고, 결과 이벤트만 받아도 분석/검증이 가능하도록 의도적으로 재발행한다. 가스 비용보다 감사/검증 편의를 우선했다.

**DB 매핑** → 다음 두 작업을 **하나의 DB 트랜잭션**으로 수행한다.
1. `attempts` 테이블의 동일 `attempt_id` 행 UPDATE
   (`after_level`, `success`, `random_value`, `status='completed'`, `completed_*` 메타).
2. `user_items` 테이블에 `(user, item_id)` UPSERT
   (level=afterLevel, total_attempts += 1, last_* 메타 갱신).

★ **`user_items` 는 별도 이벤트 없이 이 핸들러에서 자동 갱신된다.**
컨트랙트가 `UserItemStateUpdated` 를 emit하지 않기 때문이다.
이 설계 결정의 근거는 [`design_decisions.md`](./design_decisions.md) 결정 1 참고.

---

### (3) `ProbabilityTableUpdated` — 확률표 변경 (★ 차별화 핵심, 변경 없음)

> **이 이벤트가 본 프로젝트의 차별화 포인트 #3 의 근간이다.**
>
> 운영사가 단계별 확률을 변경할 때마다 영구 감사 기록을 남긴다.
> 사용자는 "내가 강화한 시점의 표기 확률은 얼마였는가?" 와
> "운영사가 몰래 확률을 바꾸지 않았는가?" 를 누구나 검증할 수 있다.

```solidity
event ProbabilityTableUpdated(
    uint8   indexed level,           // 변경된 단계
    uint32          oldSuccessRate,  // 변경 전 확률 (basis point) — 최초 설정 시 0
    uint32          newSuccessRate,  // 변경 후 확률 (basis point)
    uint256         timestamp        // 변경 시점 (block.timestamp)
);
```

**indexed 의도**:
- `level` — 단계별 변경 이력 조회가 가장 빈번. 단일 indexed로 충분.
- `oldSuccessRate`, `newSuccessRate`, `timestamp` 는 검색 키로 쓰지 않으므로 non-indexed.

**자료형 근거**:
- `level` `uint8` — `EnhancementRequested.beforeLevel` 과 동일한 타입으로 통일.
- `oldSuccessRate`, `newSuccessRate` `uint32` — `successRate` 와 동일.
- `timestamp` `uint256` — `block.timestamp` 표준 타입.

**왜 V2 단순화에서도 이 이벤트는 통합/제거하지 않았나?**
시도 이벤트와 라이프사이클이 다르다. 강화 시도가 한 건도 없는 시점에도 운영자는 확률표를 바꿀 수 있어야 하고, 그 변경 자체가 감사 기록으로 보존되어야 하기 때문이다.
즉 "시도 없는 단계 변경 추적용 안전장치" 역할이라 독립 이벤트로 유지한다.

**DB 매핑** → `probability_history` 테이블에 신규 행 INSERT.

---

## 인덱서 구현 시 주의사항

1. **멱등성**: 모든 이벤트 처리는 `tx_hash + log_index` 자연 키 기준으로 멱등하게 작성.
   동일 이벤트가 두 번 들어와도 DB 상태가 변하지 않아야 함.
2. **Reorg 방어**: 최신 블록은 reorg 가능성이 있으므로 **`latestBlock - 5` 까지만 "확정"으로 간주**한다.
3. **자료형 변환**:
   - `uint256` (attemptId, itemId, randomValue) → JS `BigInt` 또는 문자열 → DB `NUMERIC(78,0)`
   - `uint32` (successRate) → JS `Number` → DB `INTEGER`
   - `uint8` (level, beforeLevel, afterLevel, enhancementType) → JS `Number` → DB `SMALLINT`
   - `bytes32` (randomnessRequestId) → JS hex string → DB `VARCHAR(66)`
4. **이벤트 도착 순서**: VRF 비동기성 때문에 `EnhancementRequested → EnhancementCompleted` 순서가 보장되지 않을 수 있다. UPSERT 패턴으로 순서 무관하게 처리한다.
5. **DB 트랜잭션**: `EnhancementCompleted` 핸들러는 반드시 `db.transaction(async (tx) => { ... })` 안에서 `attempts` UPDATE 와 `user_items` UPSERT 를 함께 수행하여 두 테이블 무결성을 보장한다.

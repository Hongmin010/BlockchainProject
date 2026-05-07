# 컨트랙트 이벤트 명세 (v1.0 — 확정본)

> 본 문서는 **컨트랙트 팀과 백엔드 팀이 합의 완료한** 온체인 이벤트의 최종 시그니처와 의미를 정리한다.
> 인덱서(`indexer/indexer.js`)는 이 명세에 따라 이벤트를 디코딩하고 DB(`db/schema.sql`)에 저장한다.
> 변경 시 양 팀의 합의가 필요하다.

## 변경 이력 (v0 → v1)

| 항목 | v0 (초안) | v1 (확정) | 사유 |
| --- | --- | --- | --- |
| 강화 요청 ID | `requestId` | **`attemptId`** | VRF의 `requestId`와 이름 충돌 방지 |
| `successRate` | `uint256` | **`uint32`** | basis point(0~10000)는 16비트면 충분, 가스 절감 |
| `enhancementType` | `uint32` | **`uint8`** | 강화 종류는 256개면 충분, 패킹 효율 ↑ |
| `randomValue` | `uint256` | **`uint256` (유지)** | Chainlink VRF 반환 타입 그대로 |
| 이벤트 개수 | 5개 | **6개** | `ProbabilityTableUpdated` 확정 추가 |

---

## 인덱싱 대상 이벤트 (총 6개)

### (1) `EnhancementAttempted` — 강화 요청

사용자가 강화 시도를 요청한 시점에 발행된다.
이 시점에 컨트랙트가 적용한 **표기 확률(`successRate`)** 도 함께 기록되므로,
후일 "표기 확률 vs 실측" 통계 검증의 1차 근거가 된다.

```solidity
event EnhancementAttempted(
    uint256 indexed attemptId,      // 강화 시도 식별자 (컨트랙트 발급, 단조 증가)
    address indexed user,           // 시도한 사용자 지갑
    uint256 indexed itemId,         // 강화 대상 아이템 ID (NFT tokenId)
    uint8   beforeLevel,            // 강화 전 단계 (0~255)
    uint8   enhancementType,        // 강화 종류 (일반/특수/이벤트 등 256개까지)
    uint32  successRate             // 적용된 성공 확률 (basis point: 0~10000 = 0~100%)
);
```

**indexed 의도**:
- `attemptId` — 단일 시도 조회의 핵심 키, 항상 indexed.
- `user` — 사용자별 이력 필터링이 자주 일어남.
- `itemId` — 아이템별 통계(어떤 아이템이 자주 강화되는가)에 활용.

**자료형 근거**:
- `successRate` `uint32` — basis point(0~10000) 표현에는 14비트면 충분하지만, EVM 워드 패킹 단위가 32비트이므로 `uint32`가 효율적.
- `enhancementType` `uint8` — 강화 모드 가짓수는 현실적으로 수십 개 이내. 다른 `uint8` 필드(`beforeLevel`)와 한 슬롯에 패킹 가능.

**DB 매핑** → `attempts` 테이블에 신규 행 INSERT (status='pending').

---

### (2) `EnhancementResult` — 강화 결과 확정

VRF 난수가 도착하고 강화 성패가 확정될 때 발행된다.
**이 이벤트의 `randomValue`와 `RandomnessFulfilled.randomValue`는 동일해야 하며,
이 일치 여부 검증이 차별화 포인트 #2(VRF 재검증)의 핵심이다.**

```solidity
event EnhancementResult(
    uint256 indexed attemptId,      // EnhancementAttempted.attemptId 와 동일
    address indexed user,
    uint256 indexed itemId,
    uint8   beforeLevel,            // 시도 시점 단계 (감사 편의를 위해 재발행)
    uint8   afterLevel,             // 확정된 최종 단계 (성공 시 +1, 실패 시 유지/하락 등)
    bool    success,                // true=성공, false=실패
    uint32  successRate,            // 시도 시점 적용된 확률 (재발행 — 검증 편의)
    uint256 randomValue             // 실제 결과 산출에 쓰인 난수 (256bit)
);
```

**indexed 의도**: `attemptId`(요청과 매칭), `user`(이력), `itemId`(아이템별 분석) 셋 모두 필터 사용 빈도 높음.

**필드 중복(`beforeLevel`, `successRate`)에 대한 메모**:
요청 이벤트와 결과 이벤트가 다른 블록에 있을 수 있고, 결과 이벤트만 받아도 분석이 가능하도록 의도적으로 재발행한다. 가스 비용보다 감사/검증 편의를 우선했다.

**DB 매핑** → `attempts` 테이블의 동일 `attempt_id` 행 UPDATE
(`after_level`, `success`, `random_value`, `status='fulfilled'`, `fulfilled_*`).

---

### (3) `RandomnessRequested` — VRF 난수 요청 송신

컨트랙트가 Chainlink VRF Coordinator로 난수 요청을 보낸 시점에 발행된다.
`attemptId`(우리 시스템) ↔ `randomnessRequestId`(Chainlink) 매칭에 사용한다.

```solidity
event RandomnessRequested(
    uint256 indexed attemptId,             // 어떤 강화 시도에 대한 VRF인지
    address indexed user,
    bytes32         randomnessRequestId    // VRF Coordinator가 발급한 요청 ID (bytes32)
);
```

**자료형 메모**: `randomnessRequestId`는 Chainlink VRF v2 표준에서 `bytes32`로 정의된다. 우리 시스템의 `attemptId`(uint256)와 명시적으로 분리.

**DB 매핑** → `vrf_requests` 테이블에 신규 행 INSERT (status='pending').

---

### (4) `RandomnessFulfilled` — VRF 난수 콜백 도착

Chainlink VRF Coordinator가 난수 콜백을 호출하여 컨트랙트가 난수를 받았을 때 발행된다.
**이 이벤트의 `randomValue`를 백엔드에서 다시 계산하여
`EnhancementResult.success`와 일치하는지 재검증한다.**

```solidity
event RandomnessFulfilled(
    uint256 indexed attemptId,
    bytes32 indexed randomnessRequestId,
    uint256         randomValue            // VRF가 반환한 난수
);
```

**indexed 의도**: `attemptId`로 강화 시도 매칭, `randomnessRequestId`로 VRF 요청 매칭. 두 개 모두 indexed.

**DB 매핑** → `vrf_requests` 테이블의 동일 `randomness_request_id` 행 UPDATE
(`random_value`, `status='fulfilled'`, `fulfilled_*`).

---

### (5) `UserItemStateUpdated` — 사용자 아이템 상태 변경

강화 결과로 사용자의 아이템 상태(현재 단계, 누적 시도 횟수)가 변경됐을 때 발행된다.
강화 외 경로(거래, 합성 등)에서도 발행될 수 있도록 일반화된 이벤트로 설계.

```solidity
event UserItemStateUpdated(
    address indexed user,
    uint256 indexed itemId,
    uint8           level,           // 현재(갱신 후) 단계
    uint256         totalAttempts    // 해당 (user, item)의 누적 강화 시도 횟수
);
```

**indexed 의도**: `(user, itemId)` 조합으로 가장 빈번하게 조회됨.

**DB 매핑** → `user_items` 테이블에 UPSERT (PK: `(user, item_id)`).

---

### (6) `ProbabilityTableUpdated` — 확률표 변경 (★ 차별화 핵심)

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
- `level` `uint8` — `EnhancementAttempted.beforeLevel` 과 동일한 타입으로 통일.
- `oldSuccessRate`, `newSuccessRate` `uint32` — `successRate` 와 동일.
- `timestamp` `uint256` — `block.timestamp` 표준 타입.

**DB 매핑** → `probability_history` 테이블에 신규 행 INSERT.

---

## 인덱서 구현 시 주의사항

1. **멱등성**: 모든 이벤트 처리는 `tx_hash + log_index` 자연 키 기준으로 멱등하게 작성.
   동일 이벤트가 두 번 들어와도 DB 상태가 변하지 않아야 함.
2. **Reorg 방어**: 최신 블록은 reorg 가능성이 있으므로 **`latestBlock - 5` 까지만 "확정"으로 간주**한다.
3. **자료형 변환**:
   - `uint256` (attemptId, itemId, totalAttempts, randomValue) → JS `BigInt` 또는 문자열 → DB `NUMERIC(78,0)`
   - `uint32` (successRate) → JS `Number` → DB `INTEGER`
   - `uint8` (level, beforeLevel, afterLevel, enhancementType) → JS `Number` → DB `SMALLINT`
   - `bytes32` (randomnessRequestId) → JS hex string → DB `VARCHAR(66)`
4. **이벤트 도착 순서**: VRF 비동기성 때문에 `EnhancementAttempted → RandomnessRequested → RandomnessFulfilled → EnhancementResult` 순서가 보장되지 않을 수 있다. UPSERT 패턴으로 순서 무관하게 처리한다.

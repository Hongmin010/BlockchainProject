# 컨트랙트 이벤트 명세 (v3 — 배포본 일치화)

> 본 문서는 **Base Sepolia 에 배포된 `EnhancementGameVRF`**
> (`0xd9f2e53cad519668d02ecc0dbdd49b42938e9ab2`) 의 이벤트 시그니처를
> ground truth 로 한다.
> 인덱서(`indexer/indexer.js`) 는 이 명세에 따라 이벤트를 디코딩하여
> DB(`db/schema.sql`) 에 저장한다.
> 컨트랙트 변경 시 본 문서 + 인덱서 + 스키마를 함께 갱신한다.

---

## 변경 이력 (v2 → v3)

V2 단순화 명세(사고는 [design_decisions.md](./design_decisions.md))와
실제 배포된 컨트랙트의 시그니처가 어긋나, **v3 에서는 배포본을 ground truth 로 채택**하고
백엔드를 거기에 맞춘다. 재배포는 가스/subscription 비용 + 데이터 손실 비용이 더 크다.

### V2 → 배포본 차이 매핑

| 항목 | V2 명세 | 배포본 (v3) | 백엔드 처리 |
| --- | --- | --- | --- |
| 결과 이벤트명 | `EnhancementCompleted` | `EnhancementResult` | 인덱서 핸들러명 변경 |
| VRF 요청 ID 자료형 | `bytes32 randomnessRequestId` | `uint256 vrfRequestId` | `attempts.vrf_request_id NUMERIC(78,0)` |
| 결과 표현 | `bool success` | `uint8 resultType` (0=Fail, 1=Success) | 인덱서가 `resultType === 1` 로 bool 변환, DB 는 `BOOLEAN` 유지 |
| `successRate` 자료형 | `uint32` | `uint16` (basis point) | DB `INTEGER` 호환 (10000 표현 충분) |
| `EnhancementRequested` 포함 필드 | `beforeLevel, enhancementType, successRate, randomnessRequestId` | **`vrfRequestId` 만** | `before_level` / `claimed_success_rate` NULL 허용, 결과 이벤트에서 채움 |
| `ProbabilityTableUpdated` 필드 | `(level, oldRate, newRate, timestamp)` | `(updater, level, enhancementType, oldBps, newBps)` | `updater` + `enhancement_type` 컬럼 추가, `timestamp` 은 인덱서가 `block.timestamp` 로 보강 |
| `enhancementType` (시도별) | 이벤트로 발행 | 이벤트에 없음 (컨트랙트 mapping 에만, fulfill 후 삭제) | `attempts.enhancement_type` 컬럼 제거 |

### V2 사고는 보존된다

V2 단순화의 *사고* 자체는 그대로 유효하고 v3 에서도 적용된다:
- 강화 1회당 emit 이벤트 수 = **2개** (Requested + Result) — VRF 라이프사이클 통합 유지.
- `UserItemStateUpdated` 미발행 → 인덱서가 `EnhancementResult` 처리 시 `user_items` 자동 UPSERT.
- "이벤트는 사용자 가스 비용, 테이블은 운영자 인프라 비용" 분리 사고 유지.

자세한 배경: [design_decisions.md](./design_decisions.md) 결정 1·2·3.

---

## 인덱싱 대상 이벤트 (총 3개)

### (1) `EnhancementRequested` — 강화 시도 요청 + VRF 송신

사용자가 강화 시도를 요청하면 컨트랙트가 같은 트랜잭션에서 VRF Coordinator 에
난수 요청을 보낸다.

```solidity
event EnhancementRequested(
    uint256 indexed attemptId,    // 강화 시도 식별자 (컨트랙트 발급, 단조 증가)
    address indexed user,         // 시도한 사용자 지갑
    uint256 indexed itemId,       // 강화 대상 아이템 ID
    uint256         vrfRequestId  // VRF Coordinator 발급 요청 ID
);
```

**indexed 의도**: `attemptId`(시도 조회), `user`(이력), `itemId`(아이템별 분석).

**DB 매핑** → `attempts` UPSERT (`status='pending'`):
- `(attempt_id, user_address, item_id, vrf_request_id, status='pending', requested_*)` INSERT
- `attempt_id` 충돌 시 (결과 이벤트가 먼저 도착한 경우) `requested_*` 메타만 채우는 패턴 (UPSERT + COALESCE).

**한계 (의도적)**: 이 이벤트엔 `beforeLevel`, `successRate` 가 없다.
→ 두 컬럼은 `EnhancementResult` 도착 시점에 채워진다.
→ `attempts.before_level`, `attempts.claimed_success_rate` 는 NULL 허용.

---

### (2) `EnhancementResult` — 강화 결과 확정 + VRF 응답

VRF 난수가 도착하고 강화 성패가 확정될 때 발행된다.
**이 이벤트의 `randomValue` 가 컨트랙트의 결과 산출에 실제로 쓰인 난수**이며,
백엔드는 이를 off-chain 에서 재계산하여 `resultType` 과 일치하는지 검증 — 이것이 차별화 #2 (VRF 재검증).

```solidity
event EnhancementResult(
    uint256 indexed attemptId,
    address indexed user,
    uint256 indexed itemId,
    uint256         vrfRequestId,
    uint8           beforeLevel,
    uint8           afterLevel,
    uint8           resultType,        // 0 = Fail, 1 = Success
    uint16          successRateBps,    // 시도 시 적용된 확률 (basis point)
    uint256         randomValue
);
```

**DB 매핑** → `attempts` UPSERT + `user_items` UPSERT, **한 트랜잭션**:
1. `attempts`: `attempt_id` 기준 UPSERT — `before_level`, `after_level`, `claimed_success_rate`, `success`, `random_value`, `status='completed'`, `completed_*` 채움. Requested 가 아직 안 왔다면 `vrf_request_id` 도 같이 채움.
2. `user_items`: `(user, item_id)` UPSERT — `level=afterLevel`, `total_attempts += 1`, `last_*` 갱신.

**bool 변환**: `success = (resultType === 1)`.

**멱등성 보강**: `attempts` UPSERT 시 `WHERE attempts.status='pending'` 조건으로
이미 `completed` 인 경우 SKIP. 그 결과 user_items UPSERT 도 건너뛰어 `total_attempts` 중복 +1 방지.

★ `user_items` 자동 갱신: 컨트랙트가 `UserItemStateUpdated` 를 emit 하지 않으므로
백엔드가 결과 핸들러에서 직접 UPSERT 한다 — [design_decisions.md](./design_decisions.md) 결정 1.

**VRF 재검증 공식** (`utils/verify.js:verifySuccess`):
`(randomValue % 10000) < successRateBps  ⇔  success`

---

### (3) `ProbabilityTableUpdated` — 확률표 변경 (★ 차별화 #3)

```solidity
event ProbabilityTableUpdated(
    address indexed updater,             // 변경 실행 주소 (onlyOwner)
    uint8   indexed level,
    uint8   indexed enhancementType,
    uint16          oldSuccessRateBps,
    uint16          newSuccessRateBps
    // ★ on-chain timestamp 는 emit 되지 않는다 — 인덱서가 block.timestamp 로 보강
);
```

**DB 매핑** → `probability_history` INSERT:
`(updater, level, enhancement_type, old_success_rate, new_success_rate, on_chain_timestamp, tx_hash, log_index, block_number)`

**indexed 의도**: `updater`(누가), `level`(어느 단계), `enhancementType`(어느 강화 종류).

**on_chain_timestamp 보강**: 컨트랙트 이벤트에 timestamp 가 없으므로
인덱서가 `provider.getBlock(blockNumber).timestamp` 로 조회하여 채운다.
같은 블록 내 다중 로그 처리 시 RPC 호출 절약을 위해 캐시.

---

## 인덱서 구현 시 주의사항

1. **멱등성**: `attempts.attempt_id` PK + UPSERT WHERE status='pending' 조건.
   `probability_history.(tx_hash, log_index)` UNIQUE.
2. **Reorg 방어**: `latestBlock - 5` 까지만 "확정" 으로 간주.
3. **도착 순서 비결정성**: VRF 비동기성으로 Requested 보다 Result 가 먼저 도착할 수 있음.
   UPSERT + COALESCE 로 순서 무관 처리.
4. **DB 트랜잭션**: `EnhancementResult` 핸들러는 `db.withTransaction` 안에서
   `attempts` UPSERT 와 `user_items` UPSERT 를 묶는다.
5. **block.timestamp 캐시**: 한 tick 안에서 `Map<blockNumber, Date>` 로 캐시하여
   같은 블록의 여러 로그가 같은 RPC 응답을 공유.
6. **자료형 변환**:
   - `uint256` (attemptId, itemId, vrfRequestId, randomValue) → BigInt/문자열 → `NUMERIC(78,0)`
   - `uint16` (successRateBps) → Number → `INTEGER`
   - `uint8` (level, beforeLevel, afterLevel, resultType, enhancementType) → Number → `SMALLINT`
   - `address` (user, updater) → **lowercase** 문자열 → `VARCHAR(42)`
   - `bool` (success): `resultType === 1` 로 derive → `BOOLEAN`

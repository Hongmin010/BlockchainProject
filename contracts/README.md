# EnhancementGame Contract

## Overview

`EnhancementGame`은 아이템 강화 시도와 결과를 온체인 이벤트로 기록하기 위한 스마트 컨트랙트이다.

사용자는 아이템 강화를 요청하고, 컨트랙트는 현재 강화 레벨에 따른 성공 확률을 저장한다. 이후 랜덤값이 입력되면 성공 여부를 판정하고 아이템 상태를 업데이트한다.

현재 버전은 실제 Chainlink VRF가 연결된 구조는 아니며, `owner`가 직접 랜덤값을 입력해 결과를 확정하는 테스트용 구조이다.

---

## State Variables

### `owner`

```solidity
address public owner;
```

컨트랙트 관리자 주소  
배포자가 `owner`로 설정됨

---

### `nextAttemptId`

```solidity
uint256 public nextAttemptId = 1;
```

강화 시도마다 부여되는 고유 ID
`enhance()` 호출 시마다 1씩 증가

---

### `RATE_DENOMINATOR`

```solidity
uint32 public constant RATE_DENOMINATOR = 10000;
```

확률 계산 기준값

```text
10000 = 100%
9000  = 90%
5000  = 50%
1000  = 10%
```

---

## Structs

### `ItemState`

```solidity
struct ItemState {
    uint8 level;
    uint256 totalAttempts;
}
```

사용자의 특정 아이템 상태를 저장

| Field | Description |
|---|---|
| `level` | 현재 강화 레벨 |
| `totalAttempts` | 총 강화 시도 횟수 |

---

### `Attempt`

```solidity
struct Attempt {
    address user;
    uint256 itemId;
    uint8 beforeLevel;
    uint8 enhancementType;
    uint32 successRate;
    bool resolved;
}
```

강화 시도 1건의 정보를 저장

| Field | Description |
|---|---|
| `user` | 강화 시도자 |
| `itemId` | 강화 대상 아이템 ID |
| `beforeLevel` | 강화 시도 전 레벨 |
| `enhancementType` | 강화 타입 |
| `successRate` | 시도 당시 적용된 성공 확률 |
| `resolved` | 결과 확정 여부 |

`enhancementType`은 현재 로직에는 직접 사용되지 않고, 이벤트 및 기록용으로 저장

---

## Mappings

### `userItems`

```solidity
mapping(address => mapping(uint256 => ItemState)) public userItems;
```

사용자별 아이템 상태를 저장

```text
userItems[user][itemId] = ItemState
```

---

### `probabilityTable`

```solidity
mapping(uint8 => uint32) public probabilityTable;
```

강화 레벨별 성공 확률을 저장

현재 설정 값

| Level | Success Rate |
|---|---:|
| 0 | 90% |
| 1 | 70% |
| 2 | 50% |
| 3 | 30% |
| 4 | 10% |

---

### `attempts`

```solidity
mapping(uint256 => Attempt) public attempts;
```

`attemptId`별 강화 시도 정보를 저장

---

### `vrfRequestToAttemptId`

```solidity
mapping(bytes32 => uint256) public vrfRequestToAttemptId;
```

랜덤 요청 ID와 강화 시도 ID를 매핑

```text
vrfRequestToAttemptId[randomnessRequestId] = attemptId
```

---

## Modifiers

### `onlyOwner`

```solidity
modifier onlyOwner()
```

`owner`만 함수 실행을 허용

적용 함수:

- `fulfillRandomness()`
- `updateProbability()`

---

## Functions

## `constructor()`

```solidity
constructor()
```

컨트랙트 배포 시 실행

역할:

- `owner`를 배포자 주소로 설정
- 기본 강화 확률표 초기화

초기 확률:

```text
0강: 90%
1강: 70%
2강: 50%
3강: 30%
4강: 10%
```

---

## `enhance(uint256 itemId, uint8 enhancementType)`

```solidity
function enhance(uint256 itemId, uint8 enhancementType) external
```

사용자가 아이템 강화를 시도할 때 호출하는 함수

역할:

- 사용자의 현재 아이템 레벨 조회
- 현재 레벨에 맞는 성공 확률 조회
- 강화 시도 정보 저장
- `attemptId` 생성
- 랜덤 요청 ID 생성
- 강화 요청 관련 이벤트 emit

Note:

- 이 함수에서는 강화 성공/실패가 결정되지 않음
- 실제 결과 판정은 `fulfillRandomness()` 호출 이후 수행

관련 이벤트:

- `EnhancementAttempted`
- `RandomnessRequested`

---

## `_requestRandomness(uint256 attemptId)`

```solidity
function _requestRandomness(uint256 attemptId) internal returns (bytes32)
```

랜덤 요청 ID를 생성하는 내부 함수 (아직 미구현)


---

## `fulfillRandomness(bytes32 randomnessRequestId, uint256 randomValue)`

```solidity
function fulfillRandomness(
    bytes32 randomnessRequestId,
    uint256 randomValue
) external onlyOwner
```

랜덤값을 입력받아 강화 결과를 확정하는 함수

역할:

- `randomnessRequestId`로 연결된 `attemptId` 조회
- 유효하지 않은 requestId면 revert
- `_resolveEnhancement()` 호출

주의:

- `owner`만 호출 가능하다.
- 현재는 테스트용으로 owner가 직접 `randomValue`를 넣는 구조
- 실제 VRF 연동 시에는 `fulfillRandomWords()` 콜백으로 대체하는 것이 적절

---

## `_resolveEnhancement(uint256 attemptId, bytes32 randomnessRequestId, uint256 randomValue)`

```solidity
function _resolveEnhancement(
    uint256 attemptId,
    bytes32 randomnessRequestId,
    uint256 randomValue
) internal
```

강화 성공/실패를 실제로 판정하고 아이템 상태를 업데이트하는 내부 함수

역할:

- 강화 시도 정보 조회
- 이미 처리된 시도인지 확인
- 랜덤값 기반 성공 여부 계산
- 성공 시 아이템 레벨 증가
- 성공/실패와 관계없이 총 시도 횟수 증가
- 결과 이벤트 emit

성공 판정 방식:

```solidity
uint256 roll = randomValue % RATE_DENOMINATOR;
bool success = roll < attempt.successRate;
```

예시:

```text
successRate = 7000
roll < 7000이면 성공
roll >= 7000이면 실패
```

현재 실패 처리:

```text
성공: level + 1
실패: level 유지
```

관련 이벤트:

- `RandomnessFulfilled`
- `EnhancementResult`
- `UserItemStateUpdated`

---

## `updateProbability(uint8 level, uint32 newSuccessRate)`

```solidity
function updateProbability(
    uint8 level,
    uint32 newSuccessRate
) external onlyOwner
```

강화 레벨별 성공 확률을 수정하는 함수

역할:

- 특정 레벨의 성공 확률 변경
- 기존 확률과 새 확률을 이벤트로 기록

제약:

```solidity
newSuccessRate <= RATE_DENOMINATOR
```

즉, `newSuccessRate`는 10000 이하만 가능

예시:

```text
4000 = 40%
7500 = 75%
10000 = 100%
```

관련 이벤트:

- `ProbabilityTableUpdated`

---

## `getUserItemState(address user, uint256 itemId)`

```solidity
function getUserItemState(
    address user,
    uint256 itemId
) external view returns (uint8 level, uint256 totalAttempts)
```

특정 사용자의 특정 아이템 상태를 조회하는 view 함수

반환값:

| Return | Description |
|---|---|
| `level` | 현재 강화 레벨 |
| `totalAttempts` | 총 강화 시도 횟수 |

---

## Events

## `EnhancementAttempted`

```solidity
event EnhancementAttempted(
    uint256 indexed attemptId,
    address indexed user,
    uint256 indexed itemId,
    uint8 beforeLevel,
    uint8 enhancementType,
    uint32 successRate
);
```

강화 시도가 생성되었을 때 발생

기록 내용:

- 강화 시도 ID
- 사용자 주소
- 아이템 ID
- 강화 전 레벨
- 강화 타입
- 적용 성공 확률

---

## `RandomnessRequested`

```solidity
event RandomnessRequested(
    uint256 indexed attemptId,
    address indexed user,
    bytes32 randomnessRequestId
);
```

랜덤 요청 ID가 생성되었을 때 발생

기록 내용:

- 강화 시도 ID
- 사용자 주소
- 랜덤 요청 ID

---

## `RandomnessFulfilled`

```solidity
event RandomnessFulfilled(
    uint256 indexed attemptId,
    bytes32 indexed randomnessRequestId,
    uint256 randomValue
);
```

랜덤값이 입력되어 강화 판정에 사용되었을 때 발생

기록 내용:

- 강화 시도 ID
- 랜덤 요청 ID
- 판정에 사용된 랜덤값

---

## `EnhancementResult`

```solidity
event EnhancementResult(
    uint256 indexed attemptId,
    address indexed user,
    uint256 indexed itemId,
    uint8 beforeLevel,
    uint8 afterLevel,
    bool success,
    uint32 successRate,
    uint256 randomValue
);
```

강화 결과가 확정되었을 때 발생

기록 내용:

- 강화 시도 ID
- 사용자 주소
- 아이템 ID
- 강화 전 레벨
- 강화 후 레벨
- 성공 여부
- 적용 성공 확률
- 사용된 랜덤값

백엔드에서 강화 결과를 저장할 때 가장 핵심적으로 사용할 이벤트

---

## `UserItemStateUpdated`

```solidity
event UserItemStateUpdated(
    address indexed user,
    uint256 indexed itemId,
    uint8 level,
    uint256 totalAttempts
);
```

사용자 아이템 상태가 업데이트되었을 때 발생

기록 내용:

- 사용자 주소
- 아이템 ID
- 업데이트 후 레벨
- 업데이트 후 총 시도 횟수

---

## `ProbabilityTableUpdated`

```solidity
event ProbabilityTableUpdated(
    uint8 indexed level,
    uint32 oldSuccessRate,
    uint32 newSuccessRate,
    uint256 timestamp
);
```

강화 확률표가 수정되었을 때 발생

기록 내용:

- 수정된 레벨
- 기존 성공 확률
- 새 성공 확률
- 수정 시점

---

## Notes

- `fulfillRandomness()`는 테스트용 확정 함수
- `owner`가 직접 랜덤값을 넣을 수 있으므로 실제 서비스용 공정성은 보장되지 않음
- `enhancementType`은 현재 기록용이며, 강화 로직에는 반영되지 않음
- 실패 시 레벨 하락이나 아이템 파괴는 구현되어 있지 않음
- 기본 확률표는 0~4레벨까지만 설정되어 있음
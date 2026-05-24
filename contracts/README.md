# EnhancementGame Contract

## Overview

컨트랙트 이름: `EnhancementGame`

사용자는 `enhance()`를 호출해 아이템 강화를 요청하고, 컨트랙트는 Chainlink VRF Coordinator에 랜덤값을 요청
이후 VRF 콜백을 통해 랜덤값이 전달되면 강화 성공 여부를 판정하고, 아이템 레벨과 강화 시도 횟수를 업데이트


---

## Inheritance

```solidity
contract EnhancementGame is VRFConsumerBaseV2Plus
```

이 컨트랙트는 Chainlink의 `VRFConsumerBaseV2Plus`를 상속

상속을 통해 다음 기능을 사용

- VRF Coordinator와의 연결
- `fulfillRandomWords()` 콜백 처리
- `onlyOwner` 접근 제한자
- ownership 관련 기능

따라서 이 컨트랙트 내부에는 `address public owner`가 직접 선언되어 있지 않음
`onlyOwner`는 상속 컨트랙트에서 제공

---

## Constants

### `RATE_DENOMINATOR`

```solidity
uint32 public constant RATE_DENOMINATOR = 10000;
```

확률 계산 기준값

| 값 | 의미 |
|---:|---:|
| `10000` | 100% |
| `9000` | 90% |
| `7000` | 70% |
| `5000` | 50% |
| `1000` | 10% |

강화 성공 여부는 다음 방식으로 계산

```solidity
roll = randomValue % RATE_DENOMINATOR;
success = roll < successRate;
```

---

### `MAX_LEVEL`

```solidity
uint8 public constant MAX_LEVEL = 5;
```

아이템 최대 강화 레벨

현재 레벨이 `5` 이상이면 더 이상 강화할 수 없음

```solidity
require(beforeLevel < MAX_LEVEL, "Already max level");
```

---

### `BASE_SEPOLIA_VRF_COORDINATOR`

```solidity
address private constant BASE_SEPOLIA_VRF_COORDINATOR =
    0x5C210eF41CD1a72de73bF76eC39637bB0d3d7BEE;
```

Base Sepolia 네트워크의 Chainlink VRF v2.5 Coordinator 주소

`Remix VM` 같은 로컬 환경에는 이 Coordinator 컨트랙트가 존재하지 않기 때문에, VRF 요청 함수는 로컬 VM에서 정상 동작하지 않을 수 있음

---

### `KEY_HASH`

```solidity
bytes32 private constant KEY_HASH = ...
```

Chainlink VRF 요청 시 사용할 key hash 값

VRF 요청에서 어떤 gas lane / key 설정을 사용할지 지정하는 값임

---

## State Variables

### `nextAttemptId`

```solidity
uint256 public nextAttemptId = 1;
```

강화 시도마다 부여되는 고유 ID

`enhance()`가 호출될 때마다 현재 값을 `attemptId`로 사용하고, 이후 1 증가

---

### `subscriptionId`

```solidity
uint256 public immutable subscriptionId;
```

Chainlink VRF Subscription ID

컨트랙트 배포 시 constructor 인자로 전달되며, 이후 변경되지 않음

---

### `callbackGasLimit`

```solidity
uint32 public callbackGasLimit = 200_000;
```

VRF Coordinator가 랜덤값을 전달할 때 호출하는 콜백 함수의 gas limit

이 값이 너무 낮으면 `fulfillRandomWords()` 실행이 실패할 수 있음

---

### `requestConfirmations`

```solidity
uint16 public requestConfirmations = 3;
```

VRF 요청 후 랜덤값을 생성하기 전에 기다릴 block confirmation 수

---

### `numWords`

```solidity
uint32 public numWords = 1;
```

VRF로부터 받을 랜덤값 개수

현재 강화 판정에는 랜덤값 하나만 사용하므로 기본값은 `1`

---

### `nativePayment`

```solidity
bool public nativePayment = true;
```

VRF 비용을 native token으로 지불할지 여부

---

## Structs

## `ItemState`

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
| `totalAttempts` | 해당 아이템의 총 강화 시도 횟수 |

---

## `Attempt`

```solidity
struct Attempt {
    address user;
    uint256 itemId;
    uint8 beforeLevel;
    uint8 enhancementType;
    uint32 successRate;
    uint256 vrfRequestId;
    bool resolved;
}
```

강화 시도 1건에 대한 정보를 저장

| Field | Description |
|---|---|
| `user` | 강화 요청자 주소 |
| `itemId` | 강화 대상 아이템 ID |
| `beforeLevel` | 강화 시도 전 레벨 |
| `enhancementType` | 강화 타입 |
| `successRate` | 강화 시도 당시 적용된 성공 확률 |
| `vrfRequestId` | Chainlink VRF 요청 ID |
| `resolved` | 강화 결과 확정 여부 |

`enhancementType`은 현재 강화 로직에는 직접 사용되지 않음 
현재 성공 확률은 `probabilityTable[beforeLevel]` 기준으로만 결정

---

## Mappings

## `userItems`

```solidity
mapping(address => mapping(uint256 => ItemState)) public userItems;
```

사용자별 아이템 상태를 저장

```text
userItems[user][itemId] = ItemState
```

---

## `probabilityTable`

```solidity
mapping(uint8 => uint32) public probabilityTable;
```

강화 레벨별 성공 확률을 저장

초기값은 constructor에서 설정

| Current Level | Success Rate |
|---:|---:|
| 0 | 90% |
| 1 | 70% |
| 2 | 50% |
| 3 | 30% |
| 4 | 10% |

---

## `attempts`

```solidity
mapping(uint256 => Attempt) public attempts;
```

`attemptId`별 강화 시도 정보를 저장

```text
attempts[attemptId] = Attempt
```

---

## `vrfRequestToAttemptId`

```solidity
mapping(uint256 => uint256) public vrfRequestToAttemptId;
```

VRF 요청 ID와 강화 시도 ID를 연결

```text
vrfRequestToAttemptId[vrfRequestId] = attemptId
```

VRF 콜백이 들어왔을 때, 해당 랜덤값이 어떤 강화 시도에 대한 것인지 찾기 위해 사용

---

## `pendingAttemptOfItem`

```solidity
mapping(address => mapping(uint256 => uint256)) public pendingAttemptOfItem;
```

특정 사용자의 특정 아이템에 대해 아직 결과가 확정되지 않은 강화 시도가 있는지 저장

```text
pendingAttemptOfItem[user][itemId] = pending attemptId
```

값이 `0`이면 진행 중인 강화가 없다는 뜻

이 mapping을 통해 같은 아이템에 대해 VRF 결과가 나오기 전에 중복 강화 요청을 보내는 것을 방지

---

# Functions

## `constructor(uint256 _subscriptionId)`

```solidity
constructor(uint256 _subscriptionId)
    VRFConsumerBaseV2Plus(BASE_SEPOLIA_VRF_COORDINATOR)
```

컨트랙트 배포 시 한 번 실행

역할

1. Chainlink VRF Coordinator 주소를 부모 컨트랙트에 전달
2. VRF Subscription ID를 저장
3. 기본 강화 확률표를 초기화

초기 확률표

```text
0강 → 1강: 90%
1강 → 2강: 70%
2강 → 3강: 50%
3강 → 4강: 30%
4강 → 5강: 10%
```

---

## `enhance(uint256 itemId, uint8 enhancementType)`

```solidity
function enhance(uint256 itemId, uint8 enhancementType) external
```

사용자가 아이템 강화를 요청할 때 호출하는 함수

### Parameters

| Name | Type | Description |
|---|---|---|
| `itemId` | `uint256` | 강화할 아이템 ID |
| `enhancementType` | `uint8` | 강화 타입 |

### Logic

1. 같은 아이템에 대해 pending 상태의 강화 요청이 있는지 확인

```solidity
require(
    pendingAttemptOfItem[msg.sender][itemId] == 0,
    "Enhancement already pending"
);
```

2. 사용자의 아이템 상태를 조회

```solidity
ItemState storage item = userItems[msg.sender][itemId];
```

3. 현재 강화 레벨을 확인

```solidity
uint8 beforeLevel = item.level;
```

4. 최대 레벨인지 확인

```solidity
require(beforeLevel < MAX_LEVEL, "Already max level");
```

5. 현재 레벨에 해당하는 성공 확률을 조회

```solidity
uint32 successRate = probabilityTable[beforeLevel];
require(successRate > 0, "Invalid success rate");
```

6. 새로운 강화 시도 ID를 생성

```solidity
uint256 attemptId = nextAttemptId++;
```

7. 강화 시도 정보를 `attempts`에 저장

8. `EnhancementAttempted` 이벤트를 발생

9. `_requestRandomness()`를 호출해 Chainlink VRF에 랜덤값을 요청

10. 반환된 VRF request ID를 attempt와 연결

```solidity
attempts[attemptId].vrfRequestId = randomnessRequestId;
vrfRequestToAttemptId[randomnessRequestId] = attemptId;
pendingAttemptOfItem[msg.sender][itemId] = attemptId;
```

11. `RandomnessRequested` 이벤트를 발생

### Notes

- 이 함수는 강화 결과를 즉시 결정하지 않음
- 강화 결과는 VRF 콜백인 `fulfillRandomWords()`가 호출된 뒤 확정
- Remix VM 같은 로컬 환경에서는 VRF Coordinator가 없기 때문에 이 함수가 revert될 수 있음

---

## `_requestRandomness(uint256 attemptId)`

```solidity
function _requestRandomness(uint256 attemptId) internal returns (uint256)
```

Chainlink VRF Coordinator에 랜덤값을 요청하는 내부 함수

### Parameters

| Name | Type | Description |
|---|---|---|
| `attemptId` | `uint256` | 강화 시도 ID |

현재 코드에서 `attemptId`는 VRF 요청 파라미터에 직접 사용되지 않음

```solidity
attemptId;
```

이 줄은 unused variable warning을 피하기 위한 no-op에 가까움

### Return

| Type | Description |
|---|---|
| `uint256` | VRF request ID |

### Logic

아래 함수를 통해 Chainlink VRF에 랜덤값을 요청

```solidity
s_vrfCoordinator.requestRandomWords(...)
```

요청에 포함되는 값

| Field | Description |
|---|---|
| `keyHash` | 사용할 VRF key hash |
| `subId` | VRF subscription ID |
| `requestConfirmations` | 랜덤값 생성 전 대기할 confirmation 수 |
| `callbackGasLimit` | 콜백 실행 gas limit |
| `numWords` | 받을 랜덤값 개수 |
| `nativePayment` | native token 결제 여부 |

### Notes

- 이 함수는 랜덤값을 직접 생성하지 않음
- VRF 요청 ID만 반환
- 실제 랜덤값은 나중에 `fulfillRandomWords()`를 통해 전달

---

## `fulfillRandomWords(uint256 randomnessRequestId, uint256[] calldata randomWords)`

```solidity
function fulfillRandomWords(
    uint256 randomnessRequestId,
    uint256[] calldata randomWords
) internal override
```

Chainlink VRF Coordinator가 랜덤값을 전달할 때 호출하는 콜백 함수

### Parameters

| Name | Type | Description |
|---|---|---|
| `randomnessRequestId` | `uint256` | VRF request ID |
| `randomWords` | `uint256[]` | VRF가 반환한 랜덤값 배열 |

### Logic

현재 컨트랙트는 랜덤값 하나만 요청하므로 `randomWords[0]`을 사용

```solidity
fulfillRandomness(randomnessRequestId, randomWords[0]);
```

### Notes

- 사용자가 직접 호출하는 함수가 아니다.
- Remix에 보이는 `rawFulfillRandomWords()`는 Chainlink 상속 컨트랙트의 외부 진입 함수
- 실제 결과 처리는 내부 함수 `fulfillRandomness()`로 위임됨

---

## `fulfillRandomness(uint256 randomnessRequestId, uint256 randomValue)`

```solidity
function fulfillRandomness(
    uint256 randomnessRequestId,
    uint256 randomValue
) internal
```

VRF request ID와 랜덤값을 이용해 강화 시도를 찾아 결과 확정 로직으로 넘기는 내부 함수

### Parameters

| Name | Type | Description |
|---|---|---|
| `randomnessRequestId` | `uint256` | VRF request ID |
| `randomValue` | `uint256` | VRF가 반환한 랜덤값 |

### Logic

1. `randomnessRequestId`에 해당하는 `attemptId`를 찾음

```solidity
uint256 attemptId = vrfRequestToAttemptId[randomnessRequestId];
```

2. 유효한 요청인지 확인

```solidity
require(attemptId != 0, "Invalid randomness request");
```

3. `_resolveEnhancement()`를 호출해 강화 성공 여부를 판정

```solidity
_resolveEnhancement(attemptId, randomnessRequestId, randomValue);
```

---

## `_resolveEnhancement(uint256 attemptId, uint256 randomnessRequestId, uint256 randomValue)`

```solidity
function _resolveEnhancement(
    uint256 attemptId,
    uint256 randomnessRequestId,
    uint256 randomValue
) internal
```

강화 성공/실패를 실제로 판정하고 아이템 상태를 업데이트하는 내부 함수

### Parameters

| Name | Type | Description |
|---|---|---|
| `attemptId` | `uint256` | 강화 시도 ID |
| `randomnessRequestId` | `uint256` | VRF request ID |
| `randomValue` | `uint256` | VRF가 반환한 랜덤값 |

### Logic

1. 강화 시도 정보를 조회

```solidity
Attempt storage attempt = attempts[attemptId];
```

2. 이미 처리된 강화 시도인지 확인

```solidity
require(!attempt.resolved, "Already resolved");
```

3. 처리 완료 상태로 변경

```solidity
attempt.resolved = true;
```

4. 아이템 상태를 조회

```solidity
ItemState storage item = userItems[attempt.user][attempt.itemId];
```

5. 랜덤값을 0~9999 범위로 변환

```solidity
uint256 roll = randomValue % RATE_DENOMINATOR;
```

6. 성공 여부를 판정

```solidity
bool success = roll < attempt.successRate;
```

7. 성공하면 레벨을 1 증가시킴

```solidity
if (success) {
    afterLevel = attempt.beforeLevel + 1;
    item.level = afterLevel;
}
```

8. 성공/실패와 관계없이 총 강화 시도 횟수를 1 증가시킴

```solidity
item.totalAttempts += 1;
```

9. pending 상태와 VRF request mapping을 정리

```solidity
delete vrfRequestToAttemptId[randomnessRequestId];
delete pendingAttemptOfItem[attempt.user][attempt.itemId];
```

10. 결과 관련 이벤트를 발생시킴

```solidity
RandomnessFulfilled
EnhancementResult
UserItemStateUpdated
```

### Result Rule

| Result | Behavior |
|---|---|
| Success | `level = beforeLevel + 1` |
| Fail | `level` 유지 |

현재 컨트랙트에는 실패 시 레벨 하락이나 아이템 파괴 로직은 없다.

---

## `updateProbability(uint8 level, uint32 newSuccessRate)`

```solidity
function updateProbability(
    uint8 level,
    uint32 newSuccessRate
) external onlyOwner
```

강화 레벨별 성공 확률을 수정하는 관리자 함수

### Parameters

| Name | Type | Description |
|---|---|---|
| `level` | `uint8` | 확률을 수정할 강화 레벨 |
| `newSuccessRate` | `uint32` | 새 성공 확률 |

### Access Control

```solidity
external onlyOwner
```

상속된 ownership 기준으로 owner만 호출할 수 있음

### Logic

1. 수정 가능한 레벨인지 확인

```solidity
require(level < MAX_LEVEL, "Invalid level");
```

2. 확률이 100% 이하인지 확인

```solidity
require(newSuccessRate <= RATE_DENOMINATOR, "Rate too high");
```

3. 기존 확률을 저장

4. 새 확률로 업데이트

5. `ProbabilityTableUpdated` 이벤트를 발생시킴

### Example

```text
newSuccessRate = 4000 → 40%
newSuccessRate = 7500 → 75%
newSuccessRate = 10000 → 100%
```

---

## `setVrfConfig(uint32 _callbackGasLimit, uint16 _requestConfirmations, bool _nativePayment)`

```solidity
function setVrfConfig(
    uint32 _callbackGasLimit,
    uint16 _requestConfirmations,
    bool _nativePayment
) external onlyOwner
```

VRF 요청 관련 설정을 수정하는 관리자 함수이다.

### Parameters

| Name | Type | Description |
|---|---|---|
| `_callbackGasLimit` | `uint32` | VRF 콜백 실행 gas limit |
| `_requestConfirmations` | `uint16` | VRF 요청 confirmation 수 |
| `_nativePayment` | `bool` | native token 결제 여부 |

### Access Control

owner만 호출할 수 있다.

### Logic

입력받은 값으로 VRF 설정 상태변수를 업데이트

```solidity
callbackGasLimit = _callbackGasLimit;
requestConfirmations = _requestConfirmations;
nativePayment = _nativePayment;
```

---

## `getUserItemState(address user, uint256 itemId)`

```solidity
function getUserItemState(
    address user,
    uint256 itemId
) external view returns (uint8 level, uint256 totalAttempts)
```

특정 사용자의 특정 아이템 상태를 조회하는 view 함수

### Parameters

| Name | Type | Description |
|---|---|---|
| `user` | `address` | 조회할 사용자 주소 |
| `itemId` | `uint256` | 조회할 아이템 ID |

### Returns

| Name | Type | Description |
|---|---|---|
| `level` | `uint8` | 현재 강화 레벨 |
| `totalAttempts` | `uint256` | 총 강화 시도 횟수 |

---

# Events

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

강화 요청이 생성되었을 때 발생

기록 내용:

- 강화 시도 ID
- 사용자 주소
- 아이템 ID
- 강화 전 레벨
- 강화 타입
- 적용된 성공 확률

---

## `RandomnessRequested`

```solidity
event RandomnessRequested(
    uint256 indexed attemptId,
    address indexed user,
    uint256 randomnessRequestId
);
```

Chainlink VRF에 랜덤값 요청이 생성되었을 때 발생

기록 내용:

- 강화 시도 ID
- 사용자 주소
- VRF request ID

---

## `RandomnessFulfilled`

```solidity
event RandomnessFulfilled(
    uint256 indexed attemptId,
    uint256 indexed randomnessRequestId,
    uint256 randomValue
);
```

VRF 랜덤값이 전달되어 강화 판정에 사용되었을 때 발생

기록 내용:

- 강화 시도 ID
- VRF request ID
- 실제 판정에 사용된 랜덤값

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

백엔드에서 강화 결과를 저장할 때 가장 핵심적으로 사용할 이벤트이다.

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

사용자의 아이템 상태가 업데이트되었을 때 발생

기록 내용:

- 사용자 주소
- 아이템 ID
- 업데이트 후 레벨
- 업데이트 후 총 강화 시도 횟수

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

강화 성공 확률표가 수정되었을 때 발생

기록 내용:

- 수정된 강화 레벨
- 기존 성공 확률
- 새로운 성공 확률
- 수정 시점

---

# Notes

## VRF Request Flow

강화 요청부터 결과 확정까지의 내부 흐름은 다음과 같다.

```text
enhance()
→ _requestRandomness()
→ Chainlink VRF requestRandomWords()
→ fulfillRandomWords()
→ fulfillRandomness()
→ _resolveEnhancement()
```

---

## Pending Attempt

같은 사용자의 같은 아이템은 VRF 결과가 확정되기 전까지 다시 강화할 수 없다.

```solidity
pendingAttemptOfItem[user][itemId] != 0
```

이면 해당 아이템은 강화 결과 대기 중인 상태이다.

---

## Local Remix VM Limitation

이 컨트랙트는 실제 Chainlink VRF Coordinator를 호출

따라서 `Remix VM` 환경에서는 `enhance()` 실행 중 VRF 요청 부분에서 revert될 수 있다.  
실제 VRF 동작을 확인하려면 Base Sepolia 네트워크와 유효한 VRF Subscription 설정이 필요하다.

---

## Current Limitations

- 실패 시 레벨 하락 또는 아이템 파괴 기능은 없다.
- `enhancementType`은 현재 이벤트와 Attempt 기록에만 저장되며, 확률 계산에는 사용되지 않는다.
- 기본 확률표는 0~4레벨까지만 설정되어 있다.
- VRF 요청이 정상 동작하려면 올바른 subscription ID와 consumer 등록이 필요하다.
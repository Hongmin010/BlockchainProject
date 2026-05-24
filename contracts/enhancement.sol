// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract EnhancementGame {
    address public owner;
    uint256 public nextAttemptId = 1;

    uint32 public constant RATE_DENOMINATOR = 10000; // 10000 = 100.00%

    struct ItemState {
        uint8 level;
        uint256 totalAttempts;
    }

    struct Attempt {
        address user;
        uint256 itemId;
        uint8 beforeLevel;
        uint8 enhancementType;
        uint32 successRate;
        bool resolved;
    }

    mapping(address => mapping(uint256 => ItemState)) public userItems;
    mapping(uint8 => uint32) public probabilityTable;
    mapping(uint256 => Attempt) public attempts;

    // VRF requestId => attemptId
    mapping(bytes32 => uint256) public vrfRequestToAttemptId;

    event EnhancementAttempted(
        uint256 indexed attemptId,
        address indexed user,
        uint256 indexed itemId,
        uint8 beforeLevel,
        uint8 enhancementType,
        uint32 successRate
    );

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

    event RandomnessRequested(
        uint256 indexed attemptId,
        address indexed user,
        bytes32 randomnessRequestId
    );

    event RandomnessFulfilled(
        uint256 indexed attemptId,
        bytes32 indexed randomnessRequestId,
        uint256 randomValue
    );

    event UserItemStateUpdated(
        address indexed user,
        uint256 indexed itemId,
        uint8 level,
        uint256 totalAttempts
    );

    event ProbabilityTableUpdated(
        uint8 indexed level,
        uint32 oldSuccessRate,
        uint32 newSuccessRate,
        uint256 timestamp
    );

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    constructor() {
        owner = msg.sender;

        probabilityTable[0] = 9000; // 90%
        probabilityTable[1] = 7000; // 70%
        probabilityTable[2] = 5000; // 50%
        probabilityTable[3] = 3000; // 30%
        probabilityTable[4] = 1000; // 10%
    }

    function enhance(uint256 itemId, uint8 enhancementType) external {
        ItemState storage item = userItems[msg.sender][itemId];

        uint8 beforeLevel = item.level;
        uint32 successRate = probabilityTable[beforeLevel];

        require(successRate > 0, "Invalid success rate");

        uint256 attemptId = nextAttemptId++;

        attempts[attemptId] = Attempt({
            user: msg.sender,
            itemId: itemId,
            beforeLevel: beforeLevel,
            enhancementType: enhancementType,
            successRate: successRate,
            resolved: false
        });

        emit EnhancementAttempted(
            attemptId,
            msg.sender,
            itemId,
            beforeLevel,
            enhancementType,
            successRate
        );

        bytes32 randomnessRequestId = _requestRandomness(attemptId);

        vrfRequestToAttemptId[randomnessRequestId] = attemptId;

        emit RandomnessRequested(
            attemptId,
            msg.sender,
            randomnessRequestId
        );
    }

    function _requestRandomness(uint256 attemptId) internal returns (bytes32) {
        return keccak256(
            abi.encodePacked(block.number, block.timestamp, attemptId, msg.sender)
        );
    }

    function fulfillRandomness(bytes32 randomnessRequestId, uint256 randomValue) external onlyOwner {
        // 실제 Chainlink VRF에서는 이 함수가 아니라 fulfillRandomWords 콜백에서 처리
        uint256 attemptId = vrfRequestToAttemptId[randomnessRequestId];
        require(attemptId != 0, "Invalid randomness request");

        _resolveEnhancement(attemptId, randomnessRequestId, randomValue);
    }

    function _resolveEnhancement(
        uint256 attemptId,
        bytes32 randomnessRequestId,
        uint256 randomValue
    ) internal {
        Attempt storage attempt = attempts[attemptId];

        require(!attempt.resolved, "Already resolved");

        attempt.resolved = true;

        ItemState storage item = userItems[attempt.user][attempt.itemId];

        uint256 roll = randomValue % RATE_DENOMINATOR;
        bool success = roll < attempt.successRate;

        uint8 afterLevel = attempt.beforeLevel;

        if (success) {
            afterLevel = attempt.beforeLevel + 1;
            item.level = afterLevel;
        }

        item.totalAttempts += 1;

        emit RandomnessFulfilled(
            attemptId,
            randomnessRequestId,
            randomValue
        );

        emit EnhancementResult(
            attemptId,
            attempt.user,
            attempt.itemId,
            attempt.beforeLevel,
            afterLevel,
            success,
            attempt.successRate,
            randomValue
        );

        emit UserItemStateUpdated(
            attempt.user,
            attempt.itemId,
            item.level,
            item.totalAttempts
        );
    }

    function updateProbability(uint8 level, uint32 newSuccessRate) external onlyOwner {
        require(newSuccessRate <= RATE_DENOMINATOR, "Rate too high");

        uint32 oldSuccessRate = probabilityTable[level];
        probabilityTable[level] = newSuccessRate;

        emit ProbabilityTableUpdated(
            level,
            oldSuccessRate,
            newSuccessRate,
            block.timestamp
        );
    }

    function getUserItemState(
        address user,
        uint256 itemId
    ) external view returns (uint8 level, uint256 totalAttempts) {
        ItemState memory item = userItems[user][itemId];
        return (item.level, item.totalAttempts);
    }
}
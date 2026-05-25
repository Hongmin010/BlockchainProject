// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {VRFConsumerBaseV2Plus} from "@chainlink/contracts/src/v0.8/vrf/dev/VRFConsumerBaseV2Plus.sol";
import {VRFV2PlusClient} from "@chainlink/contracts/src/v0.8/vrf/dev/libraries/VRFV2PlusClient.sol";

contract EnhancementGame is VRFConsumerBaseV2Plus {
    uint256 public nextAttemptId = 1;

    uint32 public constant RATE_DENOMINATOR = 10000; // 10000 = 100.00%
    uint8 public constant MAX_LEVEL = 5;

    // Base Sepolia VRF v2.5 Coordinator
    address private constant BASE_SEPOLIA_VRF_COORDINATOR =
        0x5C210eF41CD1a72de73bF76eC39637bB0d3d7BEE;

    bytes32 private constant KEY_HASH =
        0x9e1344a1247c8a1785d0a4681a27152bffdb43666ae5bf7d14d24a5efd44bf71;

    uint256 public immutable subscriptionId;

    uint32 public callbackGasLimit = 200_000;
    uint16 public requestConfirmations = 3;
    uint32 public numWords = 1;
    bool public nativePayment = true;

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
        uint256 vrfRequestId;
        bool resolved;
    }

    mapping(address => mapping(uint256 => ItemState)) public userItems;
    mapping(uint8 => uint32) public probabilityTable;
    mapping(uint256 => Attempt) public attempts;

    // VRF requestId => attemptId
    mapping(uint256 => uint256) public vrfRequestToAttemptId;

    // user => itemId => pending attemptId
    mapping(address => mapping(uint256 => uint256)) public pendingAttemptOfItem;

    event EnhancementRequested(
        uint256 indexed attemptId,
        address indexed user,
        uint256 indexed itemId,
        bytes32 randomnessRequestId,
        uint8 beforeLevel,
        uint8 enhancementType,
        uint32 successRate
    );

    event EnhancementCompleted(
        uint256 indexed attemptId,
        address indexed user,
        uint256 indexed itemId,
        bytes32 randomnessRequestId,
        uint8 beforeLevel,
        uint8 afterLevel,
        bool success,
        uint32 successRate,
        uint256 randomValue
    );

    event ProbabilityTableUpdated(
        uint8 indexed level,
        uint32 oldSuccessRate,
        uint32 newSuccessRate,
        uint256 timestamp
    );

    constructor(uint256 _subscriptionId)
        VRFConsumerBaseV2Plus(BASE_SEPOLIA_VRF_COORDINATOR)
    {
        subscriptionId = _subscriptionId;

        probabilityTable[0] = 9000; // 90%
        probabilityTable[1] = 7000; // 70%
        probabilityTable[2] = 5000; // 50%
        probabilityTable[3] = 3000; // 30%
        probabilityTable[4] = 1000; // 10%
    }

    function enhance(uint256 itemId, uint8 enhancementType) external {
        require(
            pendingAttemptOfItem[msg.sender][itemId] == 0,
            "Enhancement already pending"
        );

        ItemState storage item = userItems[msg.sender][itemId];

        uint8 beforeLevel = item.level;
        require(beforeLevel < MAX_LEVEL, "Already max level");

        uint32 successRate = probabilityTable[beforeLevel];
        require(successRate > 0, "Invalid success rate");

        uint256 attemptId = nextAttemptId++;

        attempts[attemptId] = Attempt({
            user: msg.sender,
            itemId: itemId,
            beforeLevel: beforeLevel,
            enhancementType: enhancementType,
            successRate: successRate,
            vrfRequestId: 0,
            resolved: false
        });

        uint256 randomnessRequestId = _requestRandomness(attemptId);

        attempts[attemptId].vrfRequestId = randomnessRequestId;
        vrfRequestToAttemptId[randomnessRequestId] = attemptId;
        pendingAttemptOfItem[msg.sender][itemId] = attemptId;

        emit EnhancementRequested(
            attemptId,
            msg.sender,
            itemId,
            bytes32(randomnessRequestId),
            beforeLevel,
            enhancementType,
            successRate
        );
    }

    function _requestRandomness(uint256 attemptId) internal returns (uint256) {
        attemptId;

        return s_vrfCoordinator.requestRandomWords(
            VRFV2PlusClient.RandomWordsRequest({
                keyHash: KEY_HASH,
                subId: subscriptionId,
                requestConfirmations: requestConfirmations,
                callbackGasLimit: callbackGasLimit,
                numWords: numWords,
                extraArgs: VRFV2PlusClient._argsToBytes(
                    VRFV2PlusClient.ExtraArgsV1({nativePayment: nativePayment})
                )
            })
        );
    }

    function fulfillRandomWords(
        uint256 randomnessRequestId,
        uint256[] calldata randomWords
    ) internal override {
        fulfillRandomness(randomnessRequestId, randomWords[0]);
    }

    function fulfillRandomness(
        uint256 randomnessRequestId,
        uint256 randomValue
    ) internal {
        uint256 attemptId = vrfRequestToAttemptId[randomnessRequestId];
        require(attemptId != 0, "Invalid randomness request");

        _resolveEnhancement(attemptId, randomnessRequestId, randomValue);
    }

    function _resolveEnhancement(
        uint256 attemptId,
        uint256 randomnessRequestId,
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

        delete vrfRequestToAttemptId[randomnessRequestId];
        delete pendingAttemptOfItem[attempt.user][attempt.itemId];

        emit EnhancementCompleted(
            attemptId,
            attempt.user,
            attempt.itemId,
            bytes32(randomnessRequestId),
            attempt.beforeLevel,
            afterLevel,
            success,
            attempt.successRate,
            randomValue
        );
    }

    function updateProbability(
        uint8 level,
        uint32 newSuccessRate
    ) external onlyOwner {
        require(level < MAX_LEVEL, "Invalid level");
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

    function setVrfConfig(
        uint32 _callbackGasLimit,
        uint16 _requestConfirmations,
        bool _nativePayment
    ) external onlyOwner {
        callbackGasLimit = _callbackGasLimit;
        requestConfirmations = _requestConfirmations;
        nativePayment = _nativePayment;
    }

    function getUserItemState(
        address user,
        uint256 itemId
    ) external view returns (uint8 level, uint256 totalAttempts) {
        ItemState memory item = userItems[user][itemId];
        return (item.level, item.totalAttempts);
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {VRFConsumerBaseV2Plus} from "@chainlink/contracts/src/v0.8/vrf/dev/VRFConsumerBaseV2Plus.sol";
import {VRFV2PlusClient} from "@chainlink/contracts/src/v0.8/vrf/dev/libraries/VRFV2PlusClient.sol";

contract EnhancementGame is VRFConsumerBaseV2Plus {
    uint256 public nextAttemptId = 1;

    uint16 public constant RATE_DENOMINATOR = 10000; // 10000 = 100.00%
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
    }

    enum AttemptState {
        None,
        Pending,
        Completed
    }

    struct Attempt {
        address user;
        uint256 itemId;
        uint8 beforeLevel;
        uint8 enhancementType;
        uint16 successRateBps;
        uint256 vrfRequestId;
        AttemptState state;
    }

    mapping(address => mapping(uint256 => ItemState)) public userItems;
    mapping(address => mapping(uint256 => uint256)) public totalAttemptsOfItem;
    mapping(uint8 => mapping(uint8 => uint16)) public successRates;
    mapping(uint256 => Attempt) public attempts;

    // VRF requestId => attemptId
    mapping(uint256 => uint256) public attemptIdByVrfRequestId;

    // user => itemId => pending attemptId
    mapping(address => mapping(uint256 => uint256)) public pendingAttemptOfItem;

    event EnhancementRequested(
        uint256 indexed attemptId,
        address indexed user,
        uint256 indexed itemId,
        uint256 vrfRequestId
    );

    event EnhancementResult(
        uint256 indexed attemptId,
        address indexed user,
        uint256 indexed itemId,
        uint256 vrfRequestId,
        uint8 beforeLevel,
        uint8 afterLevel,
        uint8 resultType,
        uint16 successRateBps,
        uint256 randomValue
    );

    event ProbabilityTableUpdated(
        address indexed updater,
        uint8 indexed level,
        uint8 indexed enhancementType,
        uint16 oldSuccessRateBps,
        uint16 newSuccessRateBps
    );

    constructor(uint256 _subscriptionId)
        VRFConsumerBaseV2Plus(BASE_SEPOLIA_VRF_COORDINATOR)
    {
        subscriptionId = _subscriptionId;

        for (uint8 enhancementType = 0; enhancementType < 3; enhancementType++) {
            successRates[enhancementType][0] = 9000; // 90%
            successRates[enhancementType][1] = 7000; // 70%
            successRates[enhancementType][2] = 5000; // 50%
            successRates[enhancementType][3] = 3000; // 30%
            successRates[enhancementType][4] = 1000; // 10%
        }
    }

    function enhance(uint256 itemId, uint8 enhancementType) external {
        requestEnhancement(itemId, enhancementType);
    }

    function requestEnhancement(
        uint256 itemId,
        uint8 enhancementType
    ) public returns (uint256 attemptId, uint256 vrfRequestId) {
        require(
            pendingAttemptOfItem[msg.sender][itemId] == 0,
            "Enhancement already pending"
        );

        ItemState storage item = userItems[msg.sender][itemId];

        uint8 beforeLevel = item.level;
        require(beforeLevel < MAX_LEVEL, "Already max level");

        uint16 successRateBps = successRates[enhancementType][beforeLevel];
        require(successRateBps > 0, "Invalid success rate");

        attemptId = nextAttemptId++;

        attempts[attemptId] = Attempt({
            user: msg.sender,
            itemId: itemId,
            beforeLevel: beforeLevel,
            enhancementType: enhancementType,
            successRateBps: successRateBps,
            vrfRequestId: 0,
            state: AttemptState.Pending
        });

        vrfRequestId = _requestRandomness(attemptId);

        attempts[attemptId].vrfRequestId = vrfRequestId;
        attemptIdByVrfRequestId[vrfRequestId] = attemptId;
        pendingAttemptOfItem[msg.sender][itemId] = attemptId;

        emit EnhancementRequested(
            attemptId,
            msg.sender,
            itemId,
            vrfRequestId
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
        uint256 attemptId = attemptIdByVrfRequestId[randomnessRequestId];
        require(attemptId != 0, "Invalid randomness request");

        _resolveEnhancement(attemptId, randomnessRequestId, randomValue);
    }

    function _resolveEnhancement(
        uint256 attemptId,
        uint256 randomnessRequestId,
        uint256 randomValue
    ) internal {
        Attempt storage attempt = attempts[attemptId];

        require(attempt.state == AttemptState.Pending, "Already resolved");

        attempt.state = AttemptState.Completed;

        ItemState storage item = userItems[attempt.user][attempt.itemId];

        uint256 roll = randomValue % RATE_DENOMINATOR;
        bool success = roll < attempt.successRateBps;

        uint8 afterLevel = attempt.beforeLevel;

        if (success) {
            afterLevel = attempt.beforeLevel + 1;
            item.level = afterLevel;
        }

        totalAttemptsOfItem[attempt.user][attempt.itemId] += 1;

        delete attemptIdByVrfRequestId[randomnessRequestId];
        delete pendingAttemptOfItem[attempt.user][attempt.itemId];

        emit EnhancementResult(
            attemptId,
            attempt.user,
            attempt.itemId,
            randomnessRequestId,
            attempt.beforeLevel,
            afterLevel,
            success ? 1 : 0,
            attempt.successRateBps,
            randomValue
        );
    }

    function setSuccessRate(
        uint8 enhancementType,
        uint8 level,
        uint16 newSuccessRateBps
    ) external onlyOwner {
        require(level < MAX_LEVEL, "Invalid level");
        require(newSuccessRateBps <= RATE_DENOMINATOR, "Rate too high");

        uint16 oldSuccessRateBps = successRates[enhancementType][level];
        successRates[enhancementType][level] = newSuccessRateBps;

        emit ProbabilityTableUpdated(
            msg.sender,
            level,
            enhancementType,
            oldSuccessRateBps,
            newSuccessRateBps
        );
    }

    function updateProbability(
        uint8 level,
        uint16 newSuccessRateBps
    ) external onlyOwner {
        uint8 defaultEnhancementType = 0;

        require(level < MAX_LEVEL, "Invalid level");
        require(newSuccessRateBps <= RATE_DENOMINATOR, "Rate too high");

        uint16 oldSuccessRateBps = successRates[defaultEnhancementType][level];
        successRates[defaultEnhancementType][level] = newSuccessRateBps;

        emit ProbabilityTableUpdated(
            msg.sender,
            level,
            defaultEnhancementType,
            oldSuccessRateBps,
            newSuccessRateBps
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
        return (item.level, totalAttemptsOfItem[user][itemId]);
    }

    function getItemLevel(
        address user,
        uint256 itemId
    ) external view returns (uint8) {
        return userItems[user][itemId].level;
    }

    function getPendingAttemptId(
        address user,
        uint256 itemId
    ) external view returns (uint256) {
        return pendingAttemptOfItem[user][itemId];
    }
}

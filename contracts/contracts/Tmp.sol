// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

<<<<<<< HEAD
import "./MerkleProof.sol";

import {VRFConsumerBaseV2Plus} from "@chainlink/contracts/src/v0.8/vrf/dev/VRFConsumerBaseV2Plus.sol";
import {VRFV2PlusClient} from "@chainlink/contracts/src/v0.8/vrf/dev/libraries/VRFV2PlusClient.sol";

contract EnhancementGameVRF is VRFConsumerBaseV2Plus {
    using MerkleProof for bytes32[];

    uint16 private constant BPS_DENOMINATOR = 10_000;
    uint8 public constant MAX_LEVEL = 5;

    // Sepolia VRF v2.5 Coordinator
    address private constant BASE_SEPOLIA_VRF_COORDINATOR =
    0x5C210eF41CD1a72de73bF76eC39637bB0d3d7BEE;

    bytes32 private constant KEY_HASH =
    0x9e1344a1247c8a1785d0a4681a27152bffdb43666ae5bf7d14d24a5efd44bf71;
=======
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
>>>>>>> a569376dc138b79eca30a36de9de3f5191508ae6

    uint256 public immutable subscriptionId;

    uint32 public callbackGasLimit = 200_000;
    uint16 public requestConfirmations = 3;
    uint32 public numWords = 1;
    bool public nativePayment = true;

<<<<<<< HEAD
    bytes32 public merkleRoot;

    uint256 public nextAttemptId;

    enum AttemptState {
        None,
        PendingRandom
    }

    enum ResultType {
        Fail,
        Success
    }

    struct UserItem {
        uint8 level;
    }

    struct EnhancementAttempt {
=======
    struct ItemState {
        uint8 level;
    }

    enum AttemptState {
        None,
        Pending,
        Completed
    }

    struct Attempt {
>>>>>>> a569376dc138b79eca30a36de9de3f5191508ae6
        address user;
        uint256 itemId;
        uint8 beforeLevel;
        uint8 enhancementType;
        uint16 successRateBps;
        uint256 vrfRequestId;
        AttemptState state;
    }

<<<<<<< HEAD
    // user -> itemId -> item state
    mapping(address => mapping(uint256 => UserItem)) public userItems;

    // attemptId -> pending attempt
    mapping(uint256 => EnhancementAttempt) public attempts;

    // vrfRequestId -> attemptId
    mapping(uint256 => uint256) public attemptIdByVrfRequestId;

    // user -> itemId -> pending attemptId
    mapping(address => mapping(uint256 => uint256)) public pendingAttemptOfItem;

    // enhancementType -> level -> successRateBps
    mapping(uint8 => mapping(uint8 => uint16)) public successRates;

    // merkle leaf -> used
    mapping(bytes32 => bool) public usedEnhancementLeaves;

=======
    mapping(address => mapping(uint256 => ItemState)) public userItems;
    mapping(address => mapping(uint256 => uint256)) public totalAttemptsOfItem;
    mapping(uint8 => mapping(uint8 => uint16)) public successRates;
    mapping(uint256 => Attempt) public attempts;

    // VRF requestId => attemptId
    mapping(uint256 => uint256) public attemptIdByVrfRequestId;

    // user => itemId => pending attemptId
    mapping(address => mapping(uint256 => uint256)) public pendingAttemptOfItem;

>>>>>>> a569376dc138b79eca30a36de9de3f5191508ae6
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

<<<<<<< HEAD
    // MerkleRoot 업데이트시 이벤트
    event MerkleRootUpdated(
        bytes32 indexed oldRoot, 
        bytes32 indexed newRoot
    );

    event EnhancementProofUsed(
        bytes32 indexed leaf,
        address indexed user,
        uint256 indexed itemId,
        uint8 enhancementType,
        uint256 ticketId
    );

=======
>>>>>>> a569376dc138b79eca30a36de9de3f5191508ae6
    constructor(uint256 _subscriptionId)
        VRFConsumerBaseV2Plus(BASE_SEPOLIA_VRF_COORDINATOR)
    {
        subscriptionId = _subscriptionId;

<<<<<<< HEAD
        // enhancementType 0 기본 강화 확률표
        successRates[0][0] = 9000; // +0 -> +1, 90%
        successRates[0][1] = 7000; // +1 -> +2, 70%
        successRates[0][2] = 5000; // +2 -> +3, 50%
        successRates[0][3] = 3000; // +3 -> +4, 30%
        successRates[0][4] = 1000; // +4 -> +5, 10%
    }

    // Markle proof 없이 강화 시도 (MerkleRoot가 설정되지 않았을 때만 작동)
    function requestEnhancement(
        uint256 itemId,
        uint8 enhancementType
    ) external returns (uint256 attemptId, uint256 vrfRequestId) {
        require(merkleRoot == bytes32(0), "Merkle proof required");

        return _requestEnhancement(itemId, enhancementType);
    }


    // Markle proof 제공하여 강화 시도
    function requestEnhancementWithProof(
        uint256 itemId,
        uint8 enhancementType,
        uint256 ticketId,
        bytes32[] calldata proof
    ) external returns (uint256 attemptId, uint256 vrfRequestId) {
        bytes32 leaf = getEnhancementLeaf(
            msg.sender,
            itemId,
            enhancementType,
            ticketId
        );

        require(!usedEnhancementLeaves[leaf], "Merkle proof already used");
        require(
            isValidEnhancementProof(
                msg.sender,
                itemId,
                enhancementType,
                ticketId,
                proof
            ),
            "Invalid Merkle proof"
        );

        usedEnhancementLeaves[leaf] = true;
        emit EnhancementProofUsed(
            leaf,
            msg.sender,
            itemId,
            enhancementType,
            ticketId
        );

        return _requestEnhancement(itemId, enhancementType);
    }

    function _requestEnhancement(
        uint256 itemId,
        uint8 enhancementType
    ) internal returns (uint256 attemptId, uint256 vrfRequestId) {
=======
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
>>>>>>> a569376dc138b79eca30a36de9de3f5191508ae6
        require(
            pendingAttemptOfItem[msg.sender][itemId] == 0,
            "Enhancement already pending"
        );

<<<<<<< HEAD
        UserItem storage item = userItems[msg.sender][itemId];
=======
        ItemState storage item = userItems[msg.sender][itemId];
>>>>>>> a569376dc138b79eca30a36de9de3f5191508ae6

        uint8 beforeLevel = item.level;
        require(beforeLevel < MAX_LEVEL, "Already max level");

        uint16 successRateBps = successRates[enhancementType][beforeLevel];
        require(successRateBps > 0, "Invalid success rate");

<<<<<<< HEAD
        attemptId = ++nextAttemptId;

        vrfRequestId = s_vrfCoordinator.requestRandomWords(
            VRFV2PlusClient.RandomWordsRequest({
                keyHash: KEY_HASH,
                subId: subscriptionId,
                requestConfirmations: requestConfirmations,
                callbackGasLimit: callbackGasLimit,
                numWords: numWords,
                extraArgs: VRFV2PlusClient._argsToBytes(
                    VRFV2PlusClient.ExtraArgsV1({
                        nativePayment: nativePayment
                    })
                )
            })
        );

        attempts[attemptId] = EnhancementAttempt({
=======
        attemptId = nextAttemptId++;

        attempts[attemptId] = Attempt({
>>>>>>> a569376dc138b79eca30a36de9de3f5191508ae6
            user: msg.sender,
            itemId: itemId,
            beforeLevel: beforeLevel,
            enhancementType: enhancementType,
            successRateBps: successRateBps,
<<<<<<< HEAD
            vrfRequestId: vrfRequestId,
            state: AttemptState.PendingRandom
        });

=======
            vrfRequestId: 0,
            state: AttemptState.Pending
        });

        vrfRequestId = _requestRandomness(attemptId);

        attempts[attemptId].vrfRequestId = vrfRequestId;
>>>>>>> a569376dc138b79eca30a36de9de3f5191508ae6
        attemptIdByVrfRequestId[vrfRequestId] = attemptId;
        pendingAttemptOfItem[msg.sender][itemId] = attemptId;

        emit EnhancementRequested(
            attemptId,
            msg.sender,
            itemId,
            vrfRequestId
        );
    }

<<<<<<< HEAD
    // MerkleRoot 설정 함수
    function setMerkleRoot(bytes32 newMerkleRoot) external onlyOwner {
        bytes32 oldMerkleRoot = merkleRoot;
        merkleRoot = newMerkleRoot;

        emit MerkleRootUpdated(oldMerkleRoot, newMerkleRoot);
    }

    // Merkle proof 검증 함수
    function isValidEnhancementProof(
        address user,
        uint256 itemId,
        uint8 enhancementType,
        uint256 ticketId,
        bytes32[] calldata proof
    ) public view returns (bool) {
        if (merkleRoot == bytes32(0)) {
            return true;
        }

        bytes32 leaf = getEnhancementLeaf(
            user,
            itemId,
            enhancementType,
            ticketId
        );
        if (usedEnhancementLeaves[leaf]) {
            return false;
        }

        return proof.verify(merkleRoot, leaf);
    }

    function getEnhancementLeaf(
        address user,
        uint256 itemId,
        uint8 enhancementType,
        uint256 ticketId
    ) public pure returns (bytes32) {
        return keccak256(abi.encode(user, itemId, enhancementType, ticketId));
    }

    function fulfillRandomWords(
        uint256 vrfRequestId,
        uint256[] calldata randomWords
    ) internal override {
        uint256 attemptId = attemptIdByVrfRequestId[vrfRequestId];
        EnhancementAttempt memory attempt = attempts[attemptId];

        require(attempt.user != address(0), "Unknown VRF request");
        require(
            attempt.state == AttemptState.PendingRandom,
            "Invalid attempt state"
        );

        uint256 randomValue = randomWords[0];
        uint16 rollBps = uint16(randomValue % BPS_DENOMINATOR);

        bool success = rollBps < attempt.successRateBps;

        uint8 afterLevel = attempt.beforeLevel;
        uint8 resultType = uint8(ResultType.Fail);

        if (success) {
            afterLevel = attempt.beforeLevel + 1;
            resultType = uint8(ResultType.Success);
        }

        userItems[attempt.user][attempt.itemId].level = afterLevel;
=======
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
>>>>>>> a569376dc138b79eca30a36de9de3f5191508ae6

        emit EnhancementResult(
            attemptId,
            attempt.user,
            attempt.itemId,
<<<<<<< HEAD
            vrfRequestId,
            attempt.beforeLevel,
            afterLevel,
            resultType,
            attempt.successRateBps,
            randomValue
        );

        delete attempts[attemptId];
        delete attemptIdByVrfRequestId[vrfRequestId];
        delete pendingAttemptOfItem[attempt.user][attempt.itemId];
=======
            randomnessRequestId,
            attempt.beforeLevel,
            afterLevel,
            success ? 1 : 0,
            attempt.successRateBps,
            randomValue
        );
>>>>>>> a569376dc138b79eca30a36de9de3f5191508ae6
    }

    function setSuccessRate(
        uint8 enhancementType,
        uint8 level,
        uint16 newSuccessRateBps
    ) external onlyOwner {
        require(level < MAX_LEVEL, "Invalid level");
<<<<<<< HEAD
        require(newSuccessRateBps <= BPS_DENOMINATOR, "Invalid rate");
=======
        require(newSuccessRateBps <= RATE_DENOMINATOR, "Rate too high");
>>>>>>> a569376dc138b79eca30a36de9de3f5191508ae6

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

<<<<<<< HEAD
=======
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

>>>>>>> a569376dc138b79eca30a36de9de3f5191508ae6
    function setVrfConfig(
        uint32 _callbackGasLimit,
        uint16 _requestConfirmations,
        bool _nativePayment
    ) external onlyOwner {
        callbackGasLimit = _callbackGasLimit;
        requestConfirmations = _requestConfirmations;
        nativePayment = _nativePayment;
    }

<<<<<<< HEAD
=======
    function getUserItemState(
        address user,
        uint256 itemId
    ) external view returns (uint8 level, uint256 totalAttempts) {
        ItemState memory item = userItems[user][itemId];
        return (item.level, totalAttemptsOfItem[user][itemId]);
    }

>>>>>>> a569376dc138b79eca30a36de9de3f5191508ae6
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

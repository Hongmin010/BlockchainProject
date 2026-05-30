// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

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

    uint256 public immutable subscriptionId;

    uint32 public callbackGasLimit = 200_000;
    uint16 public requestConfirmations = 3;
    uint32 public numWords = 1;
    bool public nativePayment = true;

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
        address user;
        uint256 itemId;
        uint8 beforeLevel;
        uint8 enhancementType;
        uint16 successRateBps;
        uint256 vrfRequestId;
        AttemptState state;
    }

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

    constructor(uint256 _subscriptionId)
        VRFConsumerBaseV2Plus(BASE_SEPOLIA_VRF_COORDINATOR)
    {
        subscriptionId = _subscriptionId;

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
        require(
            pendingAttemptOfItem[msg.sender][itemId] == 0,
            "Enhancement already pending"
        );

        UserItem storage item = userItems[msg.sender][itemId];

        uint8 beforeLevel = item.level;
        require(beforeLevel < MAX_LEVEL, "Already max level");

        uint16 successRateBps = successRates[enhancementType][beforeLevel];
        require(successRateBps > 0, "Invalid success rate");

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
            user: msg.sender,
            itemId: itemId,
            beforeLevel: beforeLevel,
            enhancementType: enhancementType,
            successRateBps: successRateBps,
            vrfRequestId: vrfRequestId,
            state: AttemptState.PendingRandom
        });

        attemptIdByVrfRequestId[vrfRequestId] = attemptId;
        pendingAttemptOfItem[msg.sender][itemId] = attemptId;

        emit EnhancementRequested(
            attemptId,
            msg.sender,
            itemId,
            vrfRequestId
        );
    }

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

        emit EnhancementResult(
            attemptId,
            attempt.user,
            attempt.itemId,
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
    }

    function setSuccessRate(
        uint8 enhancementType,
        uint8 level,
        uint16 newSuccessRateBps
    ) external onlyOwner {
        require(level < MAX_LEVEL, "Invalid level");
        require(newSuccessRateBps <= BPS_DENOMINATOR, "Invalid rate");

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

    function setVrfConfig(
        uint32 _callbackGasLimit,
        uint16 _requestConfirmations,
        bool _nativePayment
    ) external onlyOwner {
        callbackGasLimit = _callbackGasLimit;
        requestConfirmations = _requestConfirmations;
        nativePayment = _nativePayment;
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

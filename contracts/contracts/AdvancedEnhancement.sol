// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {VRFConsumerBaseV2Plus} from "@chainlink/contracts/src/v0.8/vrf/dev/VRFConsumerBaseV2Plus.sol";
import {VRFV2PlusClient} from "@chainlink/contracts/src/v0.8/vrf/dev/libraries/VRFV2PlusClient.sol";

interface IEnhancementGameVRF {
    function getItemLevel(address user, uint256 itemId) external view returns (uint8);
    function getPendingAttemptId(address user, uint256 itemId) external view returns (uint256);
    function merkleRoot() external view returns (bytes32);

    function isValidEnhancementProof(
        address user,
        uint256 itemId,
        uint8 enhancementType,
        bytes32[] calldata proof
    ) external view returns (bool);
}

contract AdvancedEnhancementGameVRF is VRFConsumerBaseV2Plus {
    uint16 private constant BPS_DENOMINATOR = 10_000;

    uint8 public constant REQUIRED_BASE_LEVEL = 5;
    uint8 public constant MAX_EXTRA_LEVEL = 5;
    uint8 public constant SAFE_GUARANTEE_DROP_STREAK = 2;

    // 기존 기본 강화 컨트랙트의 Merkle Tree에서 사용하던 enhancementType
    uint8 public constant BASE_PROOF_ENHANCEMENT_TYPE = 0;

    // Base Sepolia VRF v2.5 Coordinator
    address private constant BASE_SEPOLIA_VRF_COORDINATOR =
        0x5C210eF41CD1a72de73bF76eC39637bB0d3d7BEE;

    bytes32 private constant KEY_HASH =
        0x9e1344a1247c8a1785d0a4681a27152bffdb43666ae5bf7d14d24a5efd44bf71;

    IEnhancementGameVRF public immutable baseGame;
    uint256 public immutable subscriptionId;

    uint32 public callbackGasLimit = 200_000;
    uint16 public requestConfirmations = 3;
    uint32 public numWords = 1;
    bool public nativePayment = true;

    uint256 public nextAttemptId;

    enum AdvancedEnhancementMode {
        Safe,
        Risky
    }

    enum AttemptState {
        None,
        PendingRandom
    }

    enum AdvancedResultType {
        FailKeep,       // 실패, 레벨 유지
        Success,        // 성공, +1
        SafeDowngrade,  // 안전 강화 실패, -1
        Destroyed,      // 고위험 강화 파괴, 5강 복귀
        Guaranteed      // 안전 강화 보장 성공
    }

    struct AdvancedRate {
        uint16 successRateBps;
        uint16 destroyRateBps;
    }

    struct AdvancedAttempt {
        address user;
        uint256 itemId;
        uint8 mode;
        uint8 beforeExtraLevel;
        uint8 beforeSafeDropStreak;
        uint16 successRateBps;
        uint16 destroyRateBps;
        uint256 vrfRequestId;
        AttemptState state;
    }

    // 0이면 최종 5강, 1이면 최종 6강, ..., 5이면 최종 10강
    mapping(address => mapping(uint256 => uint8)) public extraLevels;

    // 안전 강화에서 실제 하락이 연속으로 발생한 횟수
    mapping(address => mapping(uint256 => uint8)) public safeDropStreaks;

    // attemptId -> attempt
    mapping(uint256 => AdvancedAttempt) public attempts;

    // vrfRequestId -> attemptId
    mapping(uint256 => uint256) public attemptIdByVrfRequestId;

    // user -> itemId -> pending attemptId
    mapping(address => mapping(uint256 => uint256)) public pendingAttemptOfItem;

    // mode -> extraLevel -> rate
    mapping(uint8 => mapping(uint8 => AdvancedRate)) public advancedRates;

    event AdvancedEnhancementRequested(
        uint256 indexed attemptId,
        address indexed user,
        uint256 indexed itemId,
        uint256 vrfRequestId,
        uint8 mode,
        uint8 beforeExtraLevel,
        uint8 beforeTotalLevel,
        uint8 beforeSafeDropStreak,
        bool guaranteed
    );

    event AdvancedEnhancementResult(
        uint256 indexed attemptId,
        address indexed user,
        uint256 indexed itemId,
        uint256 vrfRequestId,
        uint8 mode,
        uint8 beforeExtraLevel,
        uint8 afterExtraLevel,
        uint8 beforeTotalLevel,
        uint8 afterTotalLevel,
        uint8 resultType,
        uint8 beforeSafeDropStreak,
        uint8 afterSafeDropStreak,
        bool guaranteed,
        uint16 successRateBps,
        uint16 destroyRateBps,
        uint256 randomValue,
        uint16 rollBps
    );

    event AdvancedRateUpdated(
        address indexed updater,
        uint8 indexed mode,
        uint8 indexed extraLevel,
        uint16 oldSuccessRateBps,
        uint16 newSuccessRateBps,
        uint16 oldDestroyRateBps,
        uint16 newDestroyRateBps
    );

    event VrfConfigUpdated(
        uint32 oldCallbackGasLimit,
        uint32 newCallbackGasLimit,
        uint16 oldRequestConfirmations,
        uint16 newRequestConfirmations,
        bool oldNativePayment,
        bool newNativePayment
    );

    constructor(
        address _baseGame,
        uint256 _subscriptionId
    )
        VRFConsumerBaseV2Plus(BASE_SEPOLIA_VRF_COORDINATOR)
    {
        require(_baseGame != address(0), "Invalid base game");

        baseGame = IEnhancementGameVRF(_baseGame);
        subscriptionId = _subscriptionId;

        // mode 0: Safe
        // 파괴 없음, 성공률 낮음, 실패 시 하락
        advancedRates[uint8(AdvancedEnhancementMode.Safe)][0] = AdvancedRate(3000, 0); // 5 -> 6
        advancedRates[uint8(AdvancedEnhancementMode.Safe)][1] = AdvancedRate(2500, 0); // 6 -> 7
        advancedRates[uint8(AdvancedEnhancementMode.Safe)][2] = AdvancedRate(2000, 0); // 7 -> 8
        advancedRates[uint8(AdvancedEnhancementMode.Safe)][3] = AdvancedRate(1500, 0); // 8 -> 9
        advancedRates[uint8(AdvancedEnhancementMode.Safe)][4] = AdvancedRate(1000, 0); // 9 -> 10

        // mode 1: Risky
        // 성공률 높음, 실패 시 유지, 대신 파괴 확률 있음
        advancedRates[uint8(AdvancedEnhancementMode.Risky)][0] = AdvancedRate(4500, 500);  // 5 -> 6
        advancedRates[uint8(AdvancedEnhancementMode.Risky)][1] = AdvancedRate(4000, 1000); // 6 -> 7
        advancedRates[uint8(AdvancedEnhancementMode.Risky)][2] = AdvancedRate(3500, 1500); // 7 -> 8
        advancedRates[uint8(AdvancedEnhancementMode.Risky)][3] = AdvancedRate(3000, 2000); // 8 -> 9
        advancedRates[uint8(AdvancedEnhancementMode.Risky)][4] = AdvancedRate(2500, 2500); // 9 -> 10
    }

    function requestAdvancedEnhancementWithProof(
        uint256 itemId,
        uint8 mode,
        bytes32[] calldata proof
    ) external returns (uint256 attemptId, uint256 vrfRequestId) {
        require(
            baseGame.merkleRoot() != bytes32(0),
            "Base merkle root not set"
        );

        require(
            baseGame.isValidEnhancementProof(
                msg.sender,
                itemId,
                BASE_PROOF_ENHANCEMENT_TYPE,
                proof
            ),
            "Invalid base Merkle proof"
        );

        return _requestAdvancedEnhancement(itemId, mode);
    }

    function _requestAdvancedEnhancement(
        uint256 itemId,
        uint8 mode
    ) internal returns (uint256 attemptId, uint256 vrfRequestId) {
        require(mode <= uint8(AdvancedEnhancementMode.Risky), "Invalid mode");

        require(
            baseGame.getItemLevel(msg.sender, itemId) == REQUIRED_BASE_LEVEL,
            "Base level must be 5"
        );

        require(
            baseGame.getPendingAttemptId(msg.sender, itemId) == 0,
            "Base enhancement pending"
        );

        require(
            pendingAttemptOfItem[msg.sender][itemId] == 0,
            "Advanced enhancement already pending"
        );

        uint8 beforeExtraLevel = extraLevels[msg.sender][itemId];
        require(
            beforeExtraLevel < MAX_EXTRA_LEVEL,
            "Already max advanced level"
        );

        uint8 beforeSafeDropStreak = safeDropStreaks[msg.sender][itemId];

        // 안전 강화 2연속 하락으로 보장 상태가 된 경우,
        // Risky 강화로 보장을 우회하는 것을 막음.
        require(
            !(
                mode == uint8(AdvancedEnhancementMode.Risky) &&
                beforeSafeDropStreak >= SAFE_GUARANTEE_DROP_STREAK
            ),
            "Use guaranteed safe enhancement first"
        );

        AdvancedRate memory rate = advancedRates[mode][beforeExtraLevel];
        require(rate.successRateBps > 0, "Invalid success rate");
        require(
            rate.successRateBps + rate.destroyRateBps <= BPS_DENOMINATOR,
            "Invalid rate"
        );

        attemptId = ++nextAttemptId;

        bool guaranteed =
            mode == uint8(AdvancedEnhancementMode.Safe) &&
            beforeSafeDropStreak >= SAFE_GUARANTEE_DROP_STREAK;

        if (guaranteed) {
            _resolveGuaranteedSafeEnhancement(
                attemptId,
                msg.sender,
                itemId,
                beforeExtraLevel,
                beforeSafeDropStreak,
                rate.successRateBps,
                rate.destroyRateBps
            );

            return (attemptId, 0);
        }

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

        attempts[attemptId] = AdvancedAttempt({
            user: msg.sender,
            itemId: itemId,
            mode: mode,
            beforeExtraLevel: beforeExtraLevel,
            beforeSafeDropStreak: beforeSafeDropStreak,
            successRateBps: rate.successRateBps,
            destroyRateBps: rate.destroyRateBps,
            vrfRequestId: vrfRequestId,
            state: AttemptState.PendingRandom
        });

        attemptIdByVrfRequestId[vrfRequestId] = attemptId;
        pendingAttemptOfItem[msg.sender][itemId] = attemptId;

        emit AdvancedEnhancementRequested(
            attemptId,
            msg.sender,
            itemId,
            vrfRequestId,
            mode,
            beforeExtraLevel,
            _toTotalLevel(beforeExtraLevel),
            beforeSafeDropStreak,
            false
        );
    }

    function _resolveGuaranteedSafeEnhancement(
        uint256 attemptId,
        address user,
        uint256 itemId,
        uint8 beforeExtraLevel,
        uint8 beforeSafeDropStreak,
        uint16 successRateBps,
        uint16 destroyRateBps
    ) internal {
        uint8 afterExtraLevel = beforeExtraLevel + 1;
        uint8 afterSafeDropStreak = 0;

        extraLevels[user][itemId] = afterExtraLevel;
        safeDropStreaks[user][itemId] = afterSafeDropStreak;

        emit AdvancedEnhancementRequested(
            attemptId,
            user,
            itemId,
            0,
            uint8(AdvancedEnhancementMode.Safe),
            beforeExtraLevel,
            _toTotalLevel(beforeExtraLevel),
            beforeSafeDropStreak,
            true
        );

        emit AdvancedEnhancementResult(
            attemptId,
            user,
            itemId,
            0,
            uint8(AdvancedEnhancementMode.Safe),
            beforeExtraLevel,
            afterExtraLevel,
            _toTotalLevel(beforeExtraLevel),
            _toTotalLevel(afterExtraLevel),
            uint8(AdvancedResultType.Guaranteed),
            beforeSafeDropStreak,
            afterSafeDropStreak,
            true,
            successRateBps,
            destroyRateBps,
            0,
            0
        );
    }

    function fulfillRandomWords(
        uint256 vrfRequestId,
        uint256[] calldata randomWords
    ) internal override {
        uint256 attemptId = attemptIdByVrfRequestId[vrfRequestId];
        AdvancedAttempt memory attempt = attempts[attemptId];

        require(attempt.user != address(0), "Unknown VRF request");
        require(
            attempt.state == AttemptState.PendingRandom,
            "Invalid attempt state"
        );

        uint256 randomValue = randomWords[0];
        uint16 rollBps = uint16(randomValue % BPS_DENOMINATOR);

        uint8 afterExtraLevel;
        uint8 afterSafeDropStreak;
        uint8 resultType;

        if (attempt.mode == uint8(AdvancedEnhancementMode.Safe)) {
            (
                afterExtraLevel,
                afterSafeDropStreak,
                resultType
            ) = _resolveSafeResult(
                attempt.beforeExtraLevel,
                attempt.beforeSafeDropStreak,
                rollBps,
                attempt.successRateBps
            );
        } else {
            (
                afterExtraLevel,
                afterSafeDropStreak,
                resultType
            ) = _resolveRiskyResult(
                attempt.beforeExtraLevel,
                attempt.beforeSafeDropStreak,
                rollBps,
                attempt.successRateBps,
                attempt.destroyRateBps
            );
        }

        extraLevels[attempt.user][attempt.itemId] = afterExtraLevel;
        safeDropStreaks[attempt.user][attempt.itemId] = afterSafeDropStreak;

        emit AdvancedEnhancementResult(
            attemptId,
            attempt.user,
            attempt.itemId,
            vrfRequestId,
            attempt.mode,
            attempt.beforeExtraLevel,
            afterExtraLevel,
            _toTotalLevel(attempt.beforeExtraLevel),
            _toTotalLevel(afterExtraLevel),
            resultType,
            attempt.beforeSafeDropStreak,
            afterSafeDropStreak,
            false,
            attempt.successRateBps,
            attempt.destroyRateBps,
            randomValue,
            rollBps
        );

        delete attempts[attemptId];
        delete attemptIdByVrfRequestId[vrfRequestId];
        delete pendingAttemptOfItem[attempt.user][attempt.itemId];
    }

    function _resolveSafeResult(
        uint8 beforeExtraLevel,
        uint8 beforeSafeDropStreak,
        uint16 rollBps,
        uint16 successRateBps
    )
        internal
        pure
        returns (
            uint8 afterExtraLevel,
            uint8 afterSafeDropStreak,
            uint8 resultType
        )
    {
        if (rollBps < successRateBps) {
            return (
                beforeExtraLevel + 1,
                0,
                uint8(AdvancedResultType.Success)
            );
        }

        // 5강보다 아래로는 하락하지 않음.
        // 실제 하락이 발생했을 때만 safeDropStreak 증가.
        if (beforeExtraLevel > 0) {
            return (
                beforeExtraLevel - 1,
                beforeSafeDropStreak + 1,
                uint8(AdvancedResultType.SafeDowngrade)
            );
        }

        return (
            0,
            0,
            uint8(AdvancedResultType.FailKeep)
        );
    }

    function _resolveRiskyResult(
    uint8 beforeExtraLevel,
    uint8 beforeSafeDropStreak,
    uint16 rollBps,
    uint16 successRateBps,
    uint16 destroyRateBps
)
    internal
    pure
    returns (
        uint8 afterExtraLevel,
        uint8 afterSafeDropStreak,
        uint8 resultType
    )
{
    if (rollBps < successRateBps) {
        return (
            beforeExtraLevel + 1,
            0,
            uint8(AdvancedResultType.Success)
        );
    }

    if (rollBps < successRateBps + destroyRateBps) {
        return (
            0,
            0,
            uint8(AdvancedResultType.Destroyed)
        );
    }

    return (
        beforeExtraLevel,
        beforeSafeDropStreak,
        uint8(AdvancedResultType.FailKeep)
    );
}

    function setAdvancedRate(
        uint8 mode,
        uint8 extraLevel,
        uint16 newSuccessRateBps,
        uint16 newDestroyRateBps
    ) external onlyOwner {
        require(mode <= uint8(AdvancedEnhancementMode.Risky), "Invalid mode");
        require(extraLevel < MAX_EXTRA_LEVEL, "Invalid extra level");
        require(
            newSuccessRateBps + newDestroyRateBps <= BPS_DENOMINATOR,
            "Invalid rate"
        );

        if (mode == uint8(AdvancedEnhancementMode.Safe)) {
            require(newDestroyRateBps == 0, "Safe mode cannot destroy");
        }

        AdvancedRate memory oldRate = advancedRates[mode][extraLevel];

        advancedRates[mode][extraLevel] = AdvancedRate({
            successRateBps: newSuccessRateBps,
            destroyRateBps: newDestroyRateBps
        });

        emit AdvancedRateUpdated(
            msg.sender,
            mode,
            extraLevel,
            oldRate.successRateBps,
            newSuccessRateBps,
            oldRate.destroyRateBps,
            newDestroyRateBps
        );
    }

    function setVrfConfig(
        uint32 _callbackGasLimit,
        uint16 _requestConfirmations,
        bool _nativePayment
    ) external onlyOwner {
        uint32 oldCallbackGasLimit = callbackGasLimit;
        uint16 oldRequestConfirmations = requestConfirmations;
        bool oldNativePayment = nativePayment;

        callbackGasLimit = _callbackGasLimit;
        requestConfirmations = _requestConfirmations;
        nativePayment = _nativePayment;

        emit VrfConfigUpdated(
            oldCallbackGasLimit,
            _callbackGasLimit,
            oldRequestConfirmations,
            _requestConfirmations,
            oldNativePayment,
            _nativePayment
        );
    }

    function getAdvancedExtraLevel(
        address user,
        uint256 itemId
    ) external view returns (uint8) {
        return extraLevels[user][itemId];
    }

    function getTotalLevel(
        address user,
        uint256 itemId
    ) external view returns (uint8) {
        uint8 baseLevel = baseGame.getItemLevel(user, itemId);

        if (baseLevel < REQUIRED_BASE_LEVEL) {
            return baseLevel;
        }

        return REQUIRED_BASE_LEVEL + extraLevels[user][itemId];
    }

    function getSafeDropStreak(
        address user,
        uint256 itemId
    ) external view returns (uint8) {
        return safeDropStreaks[user][itemId];
    }

    function isNextSafeEnhancementGuaranteed(
        address user,
        uint256 itemId
    ) external view returns (bool) {
        return safeDropStreaks[user][itemId] >= SAFE_GUARANTEE_DROP_STREAK;
    }

    function isRiskyEnhancementBlocked(
        address user,
        uint256 itemId
    ) external view returns (bool) {
        return safeDropStreaks[user][itemId] >= SAFE_GUARANTEE_DROP_STREAK;
    }

    function getPendingAttemptId(
        address user,
        uint256 itemId
    ) external view returns (uint256) {
        return pendingAttemptOfItem[user][itemId];
    }

    function _toTotalLevel(uint8 extraLevel) internal pure returns (uint8) {
        return REQUIRED_BASE_LEVEL + extraLevel;
    }
}
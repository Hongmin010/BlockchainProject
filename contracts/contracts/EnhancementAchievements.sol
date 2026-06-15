// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";

interface IAdvancedEnhancementGame {
    function getTotalLevel(address user, uint256 itemId) external view returns (uint8);
    function getAchievementStats(
        address user,
        uint256 itemId
    )
        external
        view
        returns (
            uint64 totalAttempts,
            uint64 totalSuccesses,
            uint64 totalFailures,
            uint64 totalDestructions,
            uint64 totalSafeDowngrades,
            uint8 highestTotalLevel,
            uint8 currentSuccessStreak,
            uint8 maxSuccessStreak,
            uint8 currentFailureStreak,
            uint8 maxFailureStreak,
            uint8 lastDestroyedLevelLoss,
            uint8 maxDestroyedLevelLoss,
            uint64 totalDestroyedLevelLoss
        );
}

contract EnhancementAchievements is ERC1155, Ownable {
    uint256 public constant MAX_ENHANCEMENT_ACHIEVEMENT_ID = 6;
    uint256 public constant SUCCESS_STREAK_ACHIEVEMENT_ID = 7;
    uint8 public constant SUCCESS_STREAK_THRESHOLD = 3;

    IAdvancedEnhancementGame public immutable advancedGame;
    uint8 public immutable maxLevel;

    mapping(address => mapping(uint256 => bool)) public claimed;
    mapping(address => bool) public minters;
    mapping(address => mapping(uint256 => bytes32)) public achievementDataHash;

    event AchievementClaimed(
        address indexed user,
        uint256 indexed achievementId,
        uint256 indexed itemId,
        uint8 totalLevel
    );

    event AchievementMinted(
        address indexed user,
        uint256 indexed tokenId,
        bytes32 indexed dataHash,
        address minter
    );

    event MinterUpdated(address indexed minter, bool enabled);

    modifier onlyMinter() {
        require(minters[msg.sender] || msg.sender == owner(), "Not minter");
        _;
    }

    constructor(
        address advancedGameAddress,
        string memory metadataUri,
        uint8 maxLevel_
    ) ERC1155(metadataUri) {
        require(advancedGameAddress != address(0), "Invalid advanced game");
        require(maxLevel_ > 0, "Invalid max level");

        advancedGame = IAdvancedEnhancementGame(advancedGameAddress);
        maxLevel = maxLevel_;
    }

    function claimMaxEnhancement(uint256 itemId) external {
        _mintMaxEnhancement(msg.sender, itemId);
    }

    function claimSuccessStreak(uint256 itemId) external {
        _mintSuccessStreak(msg.sender, itemId);
    }

    function awardMaxEnhancement(address user, uint256 itemId) external onlyOwner {
        _mintMaxEnhancement(user, itemId);
    }

    function setURI(string memory newUri) external onlyOwner {
        _setURI(newUri);
    }

    function setMinter(address minter, bool enabled) external onlyOwner {
        require(minter != address(0), "Invalid minter");

        minters[minter] = enabled;

        emit MinterUpdated(minter, enabled);
    }

    function mintAchievement(
        address user,
        uint256 tokenId,
        bytes32 dataHash
    ) external onlyMinter {
        require(user != address(0), "Invalid user");
        require(tokenId != 0, "Invalid token");
        require(dataHash != bytes32(0), "Invalid data hash");
        require(!claimed[user][tokenId], "Achievement already claimed");

        claimed[user][tokenId] = true;
        achievementDataHash[user][tokenId] = dataHash;
        _mint(user, tokenId, 1, "");

        emit AchievementMinted(user, tokenId, dataHash, msg.sender);
    }

    function hasAchievement(
        address user,
        uint256 achievementId
    ) external view returns (bool) {
        return claimed[user][achievementId];
    }

    function canClaimMaxEnhancement(
        address user,
        uint256 itemId
    ) external view returns (bool) {
        return
            !claimed[user][MAX_ENHANCEMENT_ACHIEVEMENT_ID] &&
            advancedGame.getTotalLevel(user, itemId) >= maxLevel;
    }

    function canClaimSuccessStreak(
        address user,
        uint256 itemId
    ) external view returns (bool) {
        return
            !claimed[user][SUCCESS_STREAK_ACHIEVEMENT_ID] &&
            _getMaxSuccessStreak(user, itemId) >= SUCCESS_STREAK_THRESHOLD;
    }

    function _mintMaxEnhancement(address user, uint256 itemId) internal {
        require(user != address(0), "Invalid user");
        require(
            !claimed[user][MAX_ENHANCEMENT_ACHIEVEMENT_ID],
            "Achievement already claimed"
        );

        uint8 totalLevel = advancedGame.getTotalLevel(user, itemId);
        require(totalLevel >= maxLevel, "Item is not max level");

        claimed[user][MAX_ENHANCEMENT_ACHIEVEMENT_ID] = true;
        _mint(user, MAX_ENHANCEMENT_ACHIEVEMENT_ID, 1, "");

        emit AchievementClaimed(
            user,
            MAX_ENHANCEMENT_ACHIEVEMENT_ID,
            itemId,
            totalLevel
        );
    }

    function _mintSuccessStreak(address user, uint256 itemId) internal {
        require(user != address(0), "Invalid user");
        require(
            !claimed[user][SUCCESS_STREAK_ACHIEVEMENT_ID],
            "Achievement already claimed"
        );

        uint8 maxSuccessStreak = _getMaxSuccessStreak(user, itemId);
        require(
            maxSuccessStreak >= SUCCESS_STREAK_THRESHOLD,
            "Success streak not met"
        );

        uint8 totalLevel = advancedGame.getTotalLevel(user, itemId);

        claimed[user][SUCCESS_STREAK_ACHIEVEMENT_ID] = true;
        _mint(user, SUCCESS_STREAK_ACHIEVEMENT_ID, 1, "");

        emit AchievementClaimed(
            user,
            SUCCESS_STREAK_ACHIEVEMENT_ID,
            itemId,
            totalLevel
        );
    }

    function _getMaxSuccessStreak(
        address user,
        uint256 itemId
    ) internal view returns (uint8) {
        (
            uint64 totalAttempts,
            uint64 totalSuccesses,
            uint64 totalFailures,
            uint64 totalDestructions,
            uint64 totalSafeDowngrades,
            uint8 highestTotalLevel,
            uint8 currentSuccessStreak,
            uint8 maxSuccessStreak,
            uint8 currentFailureStreak,
            uint8 maxFailureStreak,
            uint8 lastDestroyedLevelLoss,
            uint8 maxDestroyedLevelLoss,
            uint64 totalDestroyedLevelLoss
        ) = advancedGame.getAchievementStats(user, itemId);

        totalAttempts;
        totalSuccesses;
        totalFailures;
        totalDestructions;
        totalSafeDowngrades;
        highestTotalLevel;
        currentSuccessStreak;
        currentFailureStreak;
        maxFailureStreak;
        lastDestroyedLevelLoss;
        maxDestroyedLevelLoss;
        totalDestroyedLevelLoss;

        return maxSuccessStreak;
    }

    function _beforeTokenTransfer(
        address operator,
        address from,
        address to,
        uint256[] memory ids,
        uint256[] memory amounts,
        bytes memory data
    ) internal override {
        require(
            from == address(0) || to == address(0),
            "Achievements are non-transferable"
        );

        super._beforeTokenTransfer(operator, from, to, ids, amounts, data);
    }
}

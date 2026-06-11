// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";

interface IAdvancedEnhancementGame {
    function getTotalLevel(address user, uint256 itemId) external view returns (uint8);
}

contract EnhancementAchievements is ERC1155, Ownable {
    uint256 public constant MAX_ENHANCEMENT_ACHIEVEMENT_ID = 1;

    IAdvancedEnhancementGame public immutable advancedGame;
    uint8 public immutable maxLevel;

    mapping(address => mapping(uint256 => bool)) public claimed;

    event AchievementClaimed(
        address indexed user,
        uint256 indexed achievementId,
        uint256 indexed itemId,
        uint8 totalLevel
    );

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

    function awardMaxEnhancement(address user, uint256 itemId) external onlyOwner {
        _mintMaxEnhancement(user, itemId);
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

import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

const EnhancementAchievementsModule = buildModule(
  "EnhancementAchievementsModule",
  (m) => {
    const advancedGameAddress = m.getParameter("advancedGameAddress");
    const metadataUri = m.getParameter(
      "metadataUri",
      "https://example.com/metadata/achievements/{id}.json",
    );
    const maxLevel = m.getParameter("maxLevel", 10);

    const enhancementAchievements = m.contract("EnhancementAchievements", [
      advancedGameAddress,
      metadataUri,
      maxLevel,
    ]);

    return { enhancementAchievements };
  },
);

export default EnhancementAchievementsModule;

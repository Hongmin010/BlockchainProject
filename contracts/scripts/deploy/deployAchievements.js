import { readFileSync } from "fs";
import { network } from "hardhat";

function getAchievementParams() {
  const params = JSON.parse(
    readFileSync("ignition/parameters/achievement.baseSepolia.json", "utf8"),
  );

  const moduleParams = params.EnhancementAchievementsModule;

  if (!moduleParams) {
    throw new Error("EnhancementAchievementsModule params are missing");
  }

  if (!moduleParams.advancedGameAddress) {
    throw new Error("advancedGameAddress is missing");
  }

  if (!moduleParams.metadataUri) {
    throw new Error("metadataUri is missing");
  }

  if (!moduleParams.maxLevel) {
    throw new Error("maxLevel is missing");
  }

  return moduleParams;
}

async function main() {
  const { ethers } = await network.connect();
  const { advancedGameAddress, metadataUri, maxLevel, backendMinter } =
    getAchievementParams();

  const [deployer] = await ethers.getSigners();

  console.log("deployer:", deployer.address);
  console.log("advanced game:", advancedGameAddress);
  console.log("metadata URI:", metadataUri);
  console.log("required level:", maxLevel.toString());
  console.log("backend minter:", backendMinter ?? "(not set)");

  const EnhancementAchievements = await ethers.getContractFactory(
    "EnhancementAchievements",
  );

  const achievements = await EnhancementAchievements.deploy(
    advancedGameAddress,
    metadataUri,
    maxLevel,
  );

  await achievements.waitForDeployment();

  console.log(
    "EnhancementAchievements deployed to:",
    await achievements.getAddress(),
  );

  if (backendMinter && backendMinter !== ethers.ZeroAddress) {
    const minterAddress = ethers.getAddress(backendMinter);
    const tx = await achievements.setMinter(minterAddress, true);
    console.log("setMinter tx:", tx.hash);
    await tx.wait();
    console.log("backend minter registered:", minterAddress);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

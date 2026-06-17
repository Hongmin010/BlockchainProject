import { readFileSync } from "fs";
import { network } from "hardhat";

async function getCodeWithRetry(provider, address, attempts = 6) {
  for (let i = 0; i < attempts; i += 1) {
    const code = await provider.getCode(address);
    if (code !== "0x") {
      return code;
    }

    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }

  return "0x";
}

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
  const { ethers } = await network.getOrCreate();
  const { advancedGameAddress, metadataUri, maxLevel, backendMinter } =
    getAchievementParams();

  const [deployer] = await ethers.getSigners();
  const providerNetwork = await ethers.provider.getNetwork();

  console.log("deployer:", deployer.address);
  console.log("chain id:", providerNetwork.chainId.toString());
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

  const deploymentTx = achievements.deploymentTransaction();
  console.log("deploy tx:", deploymentTx?.hash ?? "(unknown)");

  let achievementAddress = await achievements.getAddress();
  if (deploymentTx) {
    const receipt = await deploymentTx.wait(2);
    console.log("deploy receipt status:", receipt.status);
    console.log("deploy receipt block:", receipt.blockNumber);
    console.log("deploy receipt contract:", receipt.contractAddress);

    if (receipt.status !== 1) {
      throw new Error(`Deployment failed in tx ${deploymentTx.hash}`);
    }

    if (receipt.contractAddress) {
      achievementAddress = receipt.contractAddress;
    }
  } else {
    await achievements.waitForDeployment();
  }

  console.log("EnhancementAchievements deployed to:", achievementAddress);

  const deployedCode = await getCodeWithRetry(
    ethers.provider,
    achievementAddress,
  );
  console.log("deployed code bytes:", (deployedCode.length - 2) / 2);
  if (deployedCode === "0x") {
    throw new Error(
      `No contract code found at deployed address ${achievementAddress}`,
    );
  }

  const deployedAchievements = EnhancementAchievements.attach(achievementAddress);

  console.log("contract owner:", await deployedAchievements.owner());

  if (backendMinter && backendMinter !== ethers.ZeroAddress) {
    const minterAddress = ethers.getAddress(backendMinter);
    await deployedAchievements.setMinter.staticCall(minterAddress, true);
    const tx = await deployedAchievements.setMinter(minterAddress, true);
    console.log("setMinter tx:", tx.hash);
    await tx.wait();
    console.log("backend minter registered:", minterAddress);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

import { readFileSync } from "fs";
import { network } from "hardhat";

function getBaseGameAddress() {
  const deployedAddresses = JSON.parse(
    readFileSync(
      "ignition/deployments/chain-84532/deployed_addresses.json",
      "utf8"
    )
  );

  return deployedAddresses["EnhancementGameVRFModule#EnhancementGameVRF"];
}

async function main() {
  const { ethers } = await network.connect();

  const baseGameAddress = getBaseGameAddress();

  if (!baseGameAddress) {
    throw new Error("Base EnhancementGameVRF address not found");
  }

  const baseGame = await ethers.getContractAt(
    "EnhancementGameVRF",
    baseGameAddress
  );

  const subscriptionId = await baseGame.subscriptionId();

  console.log("Base game:", baseGameAddress);
  console.log("Subscription ID:", subscriptionId.toString());

  const AdvancedEnhancementGameVRF = await ethers.getContractFactory(
    "AdvancedEnhancementGameVRF"
  );

  const advancedGame = await AdvancedEnhancementGameVRF.deploy(
    baseGameAddress,
    subscriptionId
  );

  await advancedGame.waitForDeployment();

  const advancedGameAddress = await advancedGame.getAddress();

  console.log("AdvancedEnhancementGameVRF deployed to:", advancedGameAddress);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
import { network } from "hardhat";
import { readFileSync } from "node:fs";

function getContractAddress() {
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

  const [signer] = await ethers.getSigners();

  const game = await ethers.getContractAt(
    "EnhancementGameVRF",
    getContractAddress(),
    signer
  );

  const pendingAttemptId = await game.getPendingAttemptId(signer.address, 1);
  const itemLevel = await game.getItemLevel(signer.address, 1);

  console.log("User:", signer.address);
  console.log("Pending attemptId:", pendingAttemptId.toString());
  console.log("Item level:", itemLevel.toString());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

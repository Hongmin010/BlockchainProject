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
  console.log("Caller:", signer.address);

  const game = await ethers.getContractAt(
    "EnhancementGameVRF",
    getContractAddress(),
    signer
  );

  const tx = await game.requestEnhancement(1, 0);

  console.log("requestEnhancement tx:", tx.hash);
  console.log("Waiting for transaction confirmation...");

  const receipt = await tx.wait();

  console.log("Confirmed in block:", receipt?.blockNumber);

  const pendingAttemptId = await game.getPendingAttemptId(signer.address, 1);
  console.log("Pending attemptId:", pendingAttemptId.toString());

  console.log("이제 VRF callback을 기다린 뒤 Etherscan Events 탭을 확인하면 됨.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

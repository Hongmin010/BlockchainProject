import { network } from "hardhat";
import fs from "fs";

const DEPLOYED_ADDRESSES_PATH =
  "./ignition/deployments/chain-84532/deployed_addresses.json";

// Merkle proof 테스트에서 itemId = 2를 썼으니까 일단 2로 확인
const ITEM_ID = 2;

function getDeployedContractAddress(): string {
  const deployed = JSON.parse(
    fs.readFileSync(DEPLOYED_ADDRESSES_PATH, "utf8")
  );

  const address = deployed["EnhancementGameVRFModule#EnhancementGameVRF"];

  if (!address) {
    throw new Error("EnhancementGameVRF deployed address not found");
  }

  return address;
}

async function main() {
  const { ethers } = await network.connect();

  const [signer] = await ethers.getSigners();
  const contractAddress = getDeployedContractAddress();

  const game = await ethers.getContractAt(
    "EnhancementGameVRF",
    contractAddress,
    signer
  );

  const pendingAttemptId = await game.getPendingAttemptId(
    signer.address,
    ITEM_ID
  );

  const itemLevel = await game.getItemLevel(signer.address, ITEM_ID);

  console.log("User:", signer.address);
  console.log("Contract:", contractAddress);
  console.log("Item ID:", ITEM_ID);
  console.log("Pending attemptId:", pendingAttemptId.toString());
  console.log("Item level:", itemLevel.toString());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
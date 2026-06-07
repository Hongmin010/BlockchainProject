import { network } from "hardhat";
import fs from "fs";

const DEPLOYED_ADDRESSES_PATH =
  "./ignition/deployments/chain-84532/deployed_addresses.json";

function getDeployedContractAddress(): string {
  const deployed = JSON.parse(
    fs.readFileSync(DEPLOYED_ADDRESSES_PATH, "utf8")
  );

  return deployed["EnhancementGameVRFModule#EnhancementGameVRF"];
}

async function main() {
  const { ethers } = await network.connect();

  const [signer] = await ethers.getSigners();
  const contractAddress = getDeployedContractAddress();

  console.log("User:", signer.address);
  console.log("Contract:", contractAddress);

  const game = await ethers.getContractAt(
    "EnhancementGameVRF",
    contractAddress,
    signer
  );

  const itemId = 2;
  const enhancementType = 0;

  // Solidity의 keccak256(abi.encode(user, itemId, enhancementType))와 동일하게 계산
  const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
    ["address", "uint256", "uint8"],
    [signer.address, itemId, enhancementType]
  );

  const leaf = ethers.keccak256(encoded);

  console.log("Leaf:", leaf);
  console.log("Setting merkleRoot = leaf...");

  const setRootTx = await game.setMerkleRoot(leaf);
  console.log("setMerkleRoot tx:", setRootTx.hash);
  await setRootTx.wait();

  console.log("Merkle root set");

  console.log("Testing requestEnhancement without proof...");
  try {
    const tx = await game.requestEnhancement(itemId, enhancementType);
    await tx.wait();

    console.log("ERROR: requestEnhancement succeeded, but it should fail.");
  } catch (error) {
    console.log("OK: requestEnhancement reverted without proof.");
  }

  console.log("Testing requestEnhancementWithProof with empty proof...");

  const proof: string[] = [];

  const tx = await game.requestEnhancementWithProof(
    itemId,
    enhancementType,
    proof
  );

  console.log("requestEnhancementWithProof tx:", tx.hash);
  await tx.wait();

  const pendingAttemptId = await game.getPendingAttemptId(
    signer.address,
    itemId
  );

  console.log("Pending attemptId:", pendingAttemptId.toString());
  console.log("Now wait for VRF callback, then check item level.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
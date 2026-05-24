import { network } from "hardhat";

const CONTRACT_ADDRESS = "0xd9f2e53cad519668d02ecc0dbdd49b42938e9ab2";

async function main() {
  const { ethers } = await network.connect();

  const [signer] = await ethers.getSigners();

  const game = await ethers.getContractAt(
    "EnhancementGameVRF",
    CONTRACT_ADDRESS,
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
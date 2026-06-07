import { ethers } from "ethers";
import dotenv from "dotenv";

dotenv.config();

if (!process.env.PRIVATE_KEY) {
  throw new Error("PRIVATE_KEY is missing in .env");
}

const provider = new ethers.JsonRpcProvider("https://sepolia.base.org");
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

const address = "0x73e8bbe5ea755376ddd30ea1a2df3dae5d289a59";
const itemId = process.env.ITEM_ID ? parseInt(process.env.ITEM_ID) : 1;
const enhancementType = 0;
const merkleProof = process.env.MERKLE_PROOF
  ? JSON.parse(process.env.MERKLE_PROOF)
  : [];

const abi = [
  "function requestEnhancement(uint256 itemId, uint8 enhancementType) external returns (uint256 attemptId, uint256 vrfRequestId)",
  "function requestEnhancementWithProof(uint256 itemId, uint8 enhancementType, bytes32[] proof) external returns (uint256 attemptId, uint256 vrfRequestId)",
  "function merkleRoot() external view returns (bytes32)",
  "function getItemLevel(address user, uint256 itemId) external view returns (uint8)",
  "function getPendingAttemptId(address user, uint256 itemId) external view returns (uint256)",
  "event EnhancementRequested(uint256 indexed attemptId, address indexed user, uint256 indexed itemId, uint256 vrfRequestId)",
  "event EnhancementResult(uint256 indexed attemptId, address indexed user, uint256 indexed itemId, uint256 vrfRequestId, uint8 beforeLevel, uint8 afterLevel, uint8 resultType, uint16 successRateBps, uint256 randomValue)"
];

const contract = new ethers.Contract(address, abi, wallet);

const merkleRoot = await contract.merkleRoot();
console.log("caller:", wallet.address);
console.log("merkleRoot:", merkleRoot);

let tx;
if (merkleRoot !== ethers.ZeroHash) {
  if (merkleProof.length === 0) {
    throw new Error(
      'Merkle root is set. Add MERKLE_PROOF=\'["0x...","0x..."]\' to .env.'
    );
  }

  tx = await contract.requestEnhancementWithProof(
    itemId,
    enhancementType,
    merkleProof
  );
} else {
  tx = await contract.requestEnhancement(itemId, enhancementType);
}

console.log("tx:", tx.hash);

const receipt = await tx.wait();
console.log("confirmed block:", receipt.blockNumber);

const requestedEvent = receipt.logs
  .map((log) => {
    try {
      return contract.interface.parseLog(log);
    } catch {
      return null;
    }
  })
  .find((event) => event?.name === "EnhancementRequested");

if (requestedEvent) {
  console.log("attemptId:", requestedEvent.args.attemptId.toString());
  console.log("vrfRequestId:", requestedEvent.args.vrfRequestId.toString());
}

const pendingAttemptId = await contract.getPendingAttemptId(wallet.address, itemId);
console.log("pendingAttemptId:", pendingAttemptId.toString());

const currentLevel = await contract.getItemLevel(wallet.address, itemId);
console.log("currentLevel:", currentLevel.toString());

if (requestedEvent) {
  const attemptId = requestedEvent.args.attemptId;
  const filter = contract.filters.EnhancementResult(attemptId);

  console.log("waiting for VRF result...");

  for (let i = 0; i < 30; i++) {
    const events = await contract.queryFilter(filter, receipt.blockNumber, "latest");

    if (events.length > 0) {
      const result = events.at(-1).args;
      console.log("result tx block:", events.at(-1).blockNumber);
      console.log("beforeLevel:", result.beforeLevel.toString());
      console.log("afterLevel:", result.afterLevel.toString());
      console.log("result:", result.resultType === 1n ? "success" : "fail");
      console.log("successRateBps:", result.successRateBps.toString());
      console.log("randomValue:", result.randomValue.toString());
      process.exit(0);
    }

    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }

  console.log("VRF result not found yet. Run this script later or check Basescan events.");
}

import { ethers } from "ethers";
import dotenv from "dotenv";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config();

if (!process.env.PRIVATE_KEY) {
  throw new Error("PRIVATE_KEY is missing in .env");
}

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const CONTRACTS_DIR = resolve(SCRIPT_DIR, "..");

const DEFAULT_CONTRACT_ADDRESS = "0x4f1c8573446efc5ae48eb453cfc66fafe26c2f5c";
const BASE_PROOF_ENHANCEMENT_TYPE = 0;
const RESULT_TYPES = [
  "FailKeep",
  "Success",
  "SafeDowngrade",
  "Destroyed",
  "Guaranteed",
];

const provider = new ethers.JsonRpcProvider(
  process.env.RPC_URL ?? process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org",
);
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

const contractAddress = process.env.CONTRACT_ADDRESS ?? DEFAULT_CONTRACT_ADDRESS;
const itemId = BigInt(process.env.ITEM_ID ?? "71");
const mode = Number(process.env.MODE ?? "0"); // 0 = Safe, 1 = Risky
const pollMs = Number(process.env.POLL_SECONDS ?? "10") * 1000;
const timeoutMs = Number(process.env.RESULT_TIMEOUT_SECONDS ?? "180") * 1000;
const configuredProofListPath = process.env.PROOF_LIST_PATH
  ? resolve(process.env.PROOF_LIST_PATH)
  : null;
const defaultProofListPath = join(CONTRACTS_DIR, "merkle-claims.baseSepolia.json");
const proofListPath =
  configuredProofListPath && existsSync(configuredProofListPath)
    ? configuredProofListPath
    : defaultProofListPath;
const abiPath = resolve(
  process.env.ADVANCED_ABI_PATH ?? join(CONTRACTS_DIR, "AdvancedEnhancementGameVRF.abi.json"),
);

const abi = JSON.parse(readFileSync(abiPath, "utf8"));
const contract = new ethers.Contract(contractAddress, abi, wallet);

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function sameAddress(a, b) {
  return a?.toLowerCase() === b?.toLowerCase();
}

function getProof() {
  if (!existsSync(proofListPath)) {
    throw new Error(`Proof list not found: ${proofListPath}`);
  }

  const proofList = JSON.parse(readFileSync(proofListPath, "utf8"));
  const claim = proofList.claims?.find(
    (entry) =>
      sameAddress(entry.user, wallet.address) &&
      BigInt(entry.itemId) === itemId &&
      Number(entry.enhancementType) === BASE_PROOF_ENHANCEMENT_TYPE,
  );

  if (!claim) {
    throw new Error(
      `No Merkle proof found for ${wallet.address}, item ${itemId}, enhancementType ${BASE_PROOF_ENHANCEMENT_TYPE}`,
    );
  }

  return claim.proof;
}

function parseLog(receipt, eventName) {
  return receipt.logs
    .map((log) => {
      try {
        return contract.interface.parseLog(log);
      } catch {
        return null;
      }
    })
    .find((event) => event?.name === eventName);
}

async function waitForResult(attemptId, fromBlock) {
  const filter = contract.filters.AdvancedEnhancementResult(attemptId);
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const events = await contract.queryFilter(filter, fromBlock, "latest");

    if (events.length > 0) {
      return events.at(-1);
    }

    await sleep(pollMs);
  }

  return null;
}

function printResult(result) {
  const resultType = Number(result.resultType);

  console.log("result:", RESULT_TYPES[resultType] ?? resultType.toString());
  console.log("mode:", Number(result.mode) === 0 ? "Safe" : "Risky");
  console.log(
    "extra level:",
    `${result.beforeExtraLevel.toString()} -> ${result.afterExtraLevel.toString()}`,
  );
  console.log(
    "total level:",
    `${result.beforeTotalLevel.toString()} -> ${result.afterTotalLevel.toString()}`,
  );
  console.log(
    "safe drop streak:",
    `${result.beforeSafeDropStreak.toString()} -> ${result.afterSafeDropStreak.toString()}`,
  );
  console.log("guaranteed:", result.guaranteed);
  console.log("successRateBps:", result.successRateBps.toString());
  console.log("destroyRateBps:", result.destroyRateBps.toString());
  console.log("rollBps:", result.rollBps.toString());
}

console.log("network: Base Sepolia");
console.log("chainId: 84532");
console.log("contract: AdvancedEnhancementGameVRF");
console.log("address:", contractAddress);
console.log("abi:", abiPath);
console.log("proof list:", proofListPath);
console.log("caller:", wallet.address);
console.log("itemId:", itemId.toString());
console.log("mode:", mode === 0 ? "Safe" : "Risky");
console.log("base proof enhancementType:", BASE_PROOF_ENHANCEMENT_TYPE);

const beforeExtraLevel = await contract.getAdvancedExtraLevel(
  wallet.address,
  itemId,
);
const beforeTotalLevel = await contract.getTotalLevel(wallet.address, itemId);
const safeDropStreak = await contract.getSafeDropStreak(wallet.address, itemId);
const pendingAttemptId = await contract.getPendingAttemptId(
  wallet.address,
  itemId,
);
const riskyBlocked = await contract.isRiskyEnhancementBlocked(
  wallet.address,
  itemId,
);
const guaranteedSafe = await contract.isNextSafeEnhancementGuaranteed(
  wallet.address,
  itemId,
);

console.log("before extra level:", beforeExtraLevel.toString());
console.log("before total level:", beforeTotalLevel.toString());
console.log("safe drop streak:", safeDropStreak.toString());
console.log("pendingAttemptId:", pendingAttemptId.toString());
console.log("next safe guaranteed:", guaranteedSafe);
console.log("risky blocked:", riskyBlocked);

if (pendingAttemptId !== 0n) {
  throw new Error(`Item has pending advanced attempt: ${pendingAttemptId}`);
}

if (mode === 1 && riskyBlocked) {
  throw new Error("Risky mode is blocked. Use Safe mode first.");
}

const tx = await contract.requestAdvancedEnhancementWithProof(
  itemId,
  mode,
  getProof(),
);

console.log("request tx:", tx.hash);

const receipt = await tx.wait();
console.log("request confirmed block:", receipt.blockNumber);

const requestedEvent = parseLog(receipt, "AdvancedEnhancementRequested");

if (!requestedEvent) {
  console.log("AdvancedEnhancementRequested event was not found in receipt");
  process.exit(0);
}

const attemptId = requestedEvent.args.attemptId;
const vrfRequestId = requestedEvent.args.vrfRequestId;
const guaranteed = requestedEvent.args.guaranteed;

console.log("attemptId:", attemptId.toString());
console.log("vrfRequestId:", vrfRequestId.toString());
console.log("guaranteed request:", guaranteed);

if (guaranteed) {
  const resultEvent = parseLog(receipt, "AdvancedEnhancementResult");

  if (!resultEvent) {
    console.log("Guaranteed result event was not found in receipt");
    process.exit(0);
  }

  printResult(resultEvent.args);
  process.exit(0);
}

console.log("waiting for VRF result...");

const resultEvent = await waitForResult(attemptId, receipt.blockNumber);

if (!resultEvent) {
  const latestTotalLevel = await contract.getTotalLevel(wallet.address, itemId);
  console.log("VRF result not found yet");
  console.log("latest total level:", latestTotalLevel.toString());
  process.exit(0);
}

printResult(resultEvent.args);

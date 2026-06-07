import { ethers } from "ethers";
import dotenv from "dotenv";
import { readFileSync } from "node:fs";

dotenv.config();

if (!process.env.PRIVATE_KEY) {
  throw new Error("PRIVATE_KEY is missing in .env");
}

const provider = new ethers.JsonRpcProvider(
  process.env.RPC_URL ?? "https://sepolia.base.org"
);
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

const proofListPath = process.env.PROOF_LIST_PATH ?? "./merkle_proof_list.json";
const proofList = JSON.parse(readFileSync(proofListPath, "utf8"));

const address = process.env.CONTRACT_ADDRESS ?? proofList.contractAddress;
const startItemId = process.env.START_ITEM_ID
  ? BigInt(process.env.START_ITEM_ID)
  : 1n;
const endItemId = process.env.END_ITEM_ID ? BigInt(process.env.END_ITEM_ID) : null;
const maxTxs = process.env.MAX_TXS ? Number(process.env.MAX_TXS) : Infinity;
const pollMs = Number(process.env.POLL_SECONDS ?? "10") * 1000;
const resultTimeoutMs = Number(process.env.RESULT_TIMEOUT_SECONDS ?? "180") * 1000;

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

function sameAddress(a, b) {
  return a?.toLowerCase() === b?.toLowerCase();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRequestedEvent(receipt) {
  return receipt.logs
    .map((log) => {
      try {
        return contract.interface.parseLog(log);
      } catch {
        return null;
      }
    })
    .find((event) => event?.name === "EnhancementRequested");
}

function getKnownTransactionHash(error) {
  const message = error?.error?.message ?? error?.shortMessage ?? error?.message;
  const rawTransaction = error?.payload?.params?.[0];

  if (message !== "already known" || !rawTransaction) {
    return null;
  }

  return ethers.keccak256(rawTransaction);
}

async function sendAndWait(transactionPromise) {
  try {
    const tx = await transactionPromise;
    console.log(`tx: ${tx.hash}`);
    return await tx.wait();
  } catch (error) {
    const knownTxHash = getKnownTransactionHash(error);

    if (!knownTxHash) {
      throw error;
    }

    console.log(`tx already known: ${knownTxHash}`);
    const receipt = await provider.waitForTransaction(knownTxHash, 1, 180_000);

    if (!receipt) {
      throw new Error(`Timed out waiting for already known tx ${knownTxHash}`);
    }

    return receipt;
  }
}

async function waitUntilNoPending(itemId) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < resultTimeoutMs) {
    const pendingAttemptId = await contract.getPendingAttemptId(
      wallet.address,
      itemId
    );

    if (pendingAttemptId === 0n) {
      return true;
    }

    console.log(
      `item ${itemId}: waiting pending attempt ${pendingAttemptId.toString()}`
    );
    await sleep(pollMs);
  }

  return false;
}

async function waitForResult(attemptId, fromBlock) {
  const filter = contract.filters.EnhancementResult(attemptId);
  const startedAt = Date.now();

  while (Date.now() - startedAt < resultTimeoutMs) {
    const events = await contract.queryFilter(filter, fromBlock, "latest");

    if (events.length > 0) {
      return events.at(-1);
    }

    await sleep(pollMs);
  }

  return null;
}

const claims = proofList.claims
  .filter((claim) => sameAddress(claim.user, wallet.address))
  .filter((claim) => BigInt(claim.itemId) >= startItemId)
  .filter((claim) => endItemId === null || BigInt(claim.itemId) <= endItemId)
  .sort((a, b) => Number(BigInt(a.itemId) - BigInt(b.itemId)));

if (claims.length === 0) {
  throw new Error(`No claims found for ${wallet.address}`);
}

const merkleRoot = await contract.merkleRoot();
console.log("caller:", wallet.address);
console.log("contract:", address);
console.log("chain merkleRoot:", merkleRoot);
console.log("file merkleRoot:", proofList.merkleRoot);
console.log("claims:", claims.length);

if (
  merkleRoot !== ethers.ZeroHash &&
  proofList.merkleRoot &&
  merkleRoot.toLowerCase() !== proofList.merkleRoot.toLowerCase()
) {
  throw new Error("Proof list merkleRoot does not match contract merkleRoot");
}

let sentTxs = 0;

for (const claim of claims) {
  if (sentTxs >= maxTxs) {
    console.log(`MAX_TXS reached: ${sentTxs}`);
    break;
  }

  const itemId = BigInt(claim.itemId);
  const enhancementType = Number(claim.enhancementType);

  while (sentTxs < maxTxs) {
    const pendingAttemptId = await contract.getPendingAttemptId(
      wallet.address,
      itemId
    );

    if (pendingAttemptId !== 0n) {
      const cleared = await waitUntilNoPending(itemId);
      if (!cleared) {
        throw new Error(`Timed out waiting for item ${itemId} pending attempt`);
      }
    }

    const level = await contract.getItemLevel(wallet.address, itemId);
    console.log(`item ${itemId}: level ${level.toString()}`);

    if (level >= 5n) {
      console.log(`item ${itemId}: max level reached, moving next`);
      break;
    }

    sentTxs++;
    console.log(`item ${itemId}: sending enhancement tx`);

    const receipt =
      merkleRoot === ethers.ZeroHash
        ? await sendAndWait(contract.requestEnhancement(itemId, enhancementType))
        : await sendAndWait(
            contract.requestEnhancementWithProof(
              itemId,
              enhancementType,
              claim.proof
            )
          );

    console.log(`item ${itemId}: confirmed block ${receipt.blockNumber}`);
    const requestedEvent = parseRequestedEvent(receipt);

    if (!requestedEvent) {
      console.log(`item ${itemId}: request confirmed, but event not parsed`);
      await waitUntilNoPending(itemId);
      continue;
    }

    const attemptId = requestedEvent.args.attemptId;
    console.log(`item ${itemId}: attempt ${attemptId.toString()}`);

    const resultEvent = await waitForResult(attemptId, receipt.blockNumber);

    if (!resultEvent) {
      const latestLevel = await contract.getItemLevel(wallet.address, itemId);
      console.log(
        `item ${itemId}: result not found yet, current level ${latestLevel.toString()}`
      );
      break;
    }

    const result = resultEvent.args;
    console.log(
      `item ${itemId}: ${result.resultType === 1n ? "success" : "fail"} ` +
        `${result.beforeLevel.toString()} -> ${result.afterLevel.toString()}`
    );
  }
}

console.log(`done. sent txs: ${sentTxs}`);

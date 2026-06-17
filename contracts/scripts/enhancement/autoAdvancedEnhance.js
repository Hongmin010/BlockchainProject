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
const CONTRACTS_DIR = resolve(SCRIPT_DIR, "../..");

const DEFAULT_CONTRACT_ADDRESS = "0x88dbfaae7134ef18d2025ae6c5db433dea474838";
const BASE_PROOF_ENHANCEMENT_TYPE = 0;
const RESULT_TYPES = [
  "FailKeep",
  "Success",
  "SafeDowngrade",
  "Destroyed",
  "Guaranteed",
];

const provider = new ethers.JsonRpcProvider(
  process.env.RPC_URL ??
    process.env.BASE_SEPOLIA_RPC_URL ??
    "https://sepolia.base.org",
);
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

const contractAddress =
  process.env.ADVANCED_CONTRACT_ADDRESS ??
  process.env.CONTRACT_ADDRESS ??
  DEFAULT_CONTRACT_ADDRESS;
const singleItemId = process.env.ITEM_ID ? BigInt(process.env.ITEM_ID) : null;
const startItemId = process.env.START_ITEM_ID
  ? BigInt(process.env.START_ITEM_ID)
  : 1n;
const endItemId = process.env.END_ITEM_ID ? BigInt(process.env.END_ITEM_ID) : null;
const preferredMode = Number(process.env.MODE ?? "0"); // 0 = Safe, 1 = Risky
const targetTotalLevel = BigInt(process.env.TARGET_TOTAL_LEVEL ?? "10");
const maxTxs = process.env.MAX_TXS ? Number(process.env.MAX_TXS) : Infinity;
const pollMs = Number(process.env.POLL_SECONDS ?? "10") * 1000;
const timeoutMs = Number(process.env.RESULT_TIMEOUT_SECONDS ?? "180") * 1000;
const proofListPath = resolve(
  process.env.PROOF_LIST_PATH ??
    join(CONTRACTS_DIR, "merkle-claims.baseSepolia.json"),
);
const abiPath = resolve(
  process.env.ADVANCED_ABI_PATH ??
    join(CONTRACTS_DIR, "AdvancedEnhancementGameVRF.abi.json"),
);

const abi = JSON.parse(readFileSync(abiPath, "utf8"));
const proofList = JSON.parse(readFileSync(proofListPath, "utf8"));
const contract = new ethers.Contract(contractAddress, abi, wallet);

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function sameAddress(a, b) {
  return a?.toLowerCase() === b?.toLowerCase();
}

function getClaims() {
  if (!existsSync(proofListPath)) {
    throw new Error(`Proof list not found: ${proofListPath}`);
  }

  const claims = (proofList.claims ?? [])
    .filter((entry) => sameAddress(entry.user, wallet.address))
    .filter(
      (entry) =>
        Number(entry.enhancementType) === BASE_PROOF_ENHANCEMENT_TYPE,
    )
    .filter((entry) => {
      const entryItemId = BigInt(entry.itemId);

      if (singleItemId !== null) {
        return entryItemId === singleItemId;
      }

      return (
        entryItemId >= startItemId &&
        (endItemId === null || entryItemId <= endItemId)
      );
    })
    .sort((a, b) => Number(BigInt(a.itemId) - BigInt(b.itemId)));

  if (claims.length === 0) {
    throw new Error(
      `No Merkle proof claims found for ${wallet.address}, enhancementType ${BASE_PROOF_ENHANCEMENT_TYPE}`,
    );
  }

  return claims;
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
    const receipt = await provider.waitForTransaction(knownTxHash, 1, timeoutMs);

    if (!receipt) {
      throw new Error(`Timed out waiting for already known tx ${knownTxHash}`);
    }

    return receipt;
  }
}

async function assertAdvancedRequestCanRun(itemId, mode, proof) {
  try {
    await contract.requestAdvancedEnhancementWithProof.staticCall(
      itemId,
      mode,
      proof,
    );
  } catch (error) {
    const reason =
      error?.reason ??
      error?.revert?.args?.[0] ??
      error?.shortMessage ??
      error?.message ??
      "unknown revert";

    throw new Error(`item ${itemId}: advanced request would revert: ${reason}`);
  }
}

async function waitUntilNoPending(itemId) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const pendingAttemptId = await contract.getPendingAttemptId(
      wallet.address,
      itemId,
    );

    if (pendingAttemptId === 0n) {
      return true;
    }

    console.log(
      `item ${itemId}: waiting pending advanced attempt ${pendingAttemptId}`,
    );
    await sleep(pollMs);
  }

  return false;
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

function formatMode(mode) {
  return mode === 0 ? "Safe" : "Risky";
}

function printResult(result) {
  const resultType = Number(result.resultType);

  console.log(
    `result: ${RESULT_TYPES[resultType] ?? resultType.toString()} ` +
      `${result.beforeTotalLevel} -> ${result.afterTotalLevel}`,
  );
  console.log(
    `extra: ${result.beforeExtraLevel} -> ${result.afterExtraLevel}, ` +
      `streak: ${result.beforeSafeDropStreak} -> ${result.afterSafeDropStreak}, ` +
      `mode: ${formatMode(Number(result.mode))}`,
  );
}

console.log("network: Base Sepolia");
console.log("contract:", contractAddress);
console.log("proof list:", proofListPath);
console.log("caller:", wallet.address);
console.log(
  "item range:",
  singleItemId !== null
    ? singleItemId.toString()
    : `${startItemId}${endItemId === null ? "+" : `-${endItemId}`}`,
);
console.log("preferred mode:", formatMode(preferredMode));
console.log("target total level:", targetTotalLevel.toString());
console.log("max txs:", Number.isFinite(maxTxs) ? maxTxs : "unlimited");

const claims = getClaims();
console.log("claims:", claims.length);

let sentTxs = 0;

for (const claim of claims) {
  if (sentTxs >= maxTxs) {
    console.log(`MAX_TXS reached: ${sentTxs}`);
    break;
  }

  const itemId = BigInt(claim.itemId);
  const proof = claim.proof;

  while (sentTxs < maxTxs) {
    const pendingAttemptId = await contract.getPendingAttemptId(
      wallet.address,
      itemId,
    );

    if (pendingAttemptId !== 0n) {
      const cleared = await waitUntilNoPending(itemId);
      if (!cleared) {
        throw new Error(
          `Timed out waiting for item ${itemId} pending attempt ${pendingAttemptId}`,
        );
      }
    }

    const totalLevel = await contract.getTotalLevel(wallet.address, itemId);
    const extraLevel = await contract.getAdvancedExtraLevel(
      wallet.address,
      itemId,
    );
    const safeDropStreak = await contract.getSafeDropStreak(
      wallet.address,
      itemId,
    );
    const riskyBlocked = await contract.isRiskyEnhancementBlocked(
      wallet.address,
      itemId,
    );

    console.log(
      `item ${itemId}: total=${totalLevel}, extra=${extraLevel}, safeDropStreak=${safeDropStreak}`,
    );

    if (totalLevel < 5n) {
      console.log(
        `item ${itemId}: base level is below 5, moving next`,
      );
      break;
    }

    if (totalLevel >= targetTotalLevel) {
      console.log(`item ${itemId}: target total level reached, moving next`);
      break;
    }

    let mode = preferredMode;

    if (mode === 1 && riskyBlocked) {
      mode = 0;
      console.log(
        `item ${itemId}: risky blocked by safe guarantee streak, switching to Safe`,
      );
    }

    await assertAdvancedRequestCanRun(itemId, mode, proof);

    sentTxs++;
    console.log(
      `item ${itemId}: sending advanced enhancement #${sentTxs} (${formatMode(mode)})`,
    );

    const receipt = await sendAndWait(
      contract.requestAdvancedEnhancementWithProof(itemId, mode, proof),
    );

    console.log(`item ${itemId}: confirmed block ${receipt.blockNumber}`);

    const requestedEvent = parseLog(receipt, "AdvancedEnhancementRequested");

    if (!requestedEvent) {
      console.log(
        `item ${itemId}: request event not found, waiting until pending clears`,
      );
      await waitUntilNoPending(itemId);
      continue;
    }

    const attemptId = requestedEvent.args.attemptId;
    const guaranteed = requestedEvent.args.guaranteed;

    console.log(`item ${itemId}: attemptId ${attemptId}, guaranteed ${guaranteed}`);

    const resultEvent = guaranteed
      ? parseLog(receipt, "AdvancedEnhancementResult")
      : await waitForResult(attemptId, receipt.blockNumber);

    if (!resultEvent) {
      const latestTotalLevel = await contract.getTotalLevel(
        wallet.address,
        itemId,
      );
      console.log(
        `item ${itemId}: result not found yet, latest total level ${latestTotalLevel}`,
      );
      break;
    }

    printResult(resultEvent.args);
  }
}

console.log(`done. sent txs: ${sentTxs}`);

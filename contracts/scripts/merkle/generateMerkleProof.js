import { ethers } from "ethers";
import dotenv from "dotenv";
import { readFileSync } from "node:fs";

dotenv.config();

const allowlistPath = process.env.ALLOWLIST_PATH;
const allowlistJson = process.env.ALLOWLIST_JSON;
const fallbackEntry = {
  user: process.env.PROOF_USER,
  itemId: process.env.PROOF_ITEM_ID ?? "1",
  enhancementType: process.env.PROOF_ENHANCEMENT_TYPE ?? "0"
};

const allowlist = allowlistPath
  ? JSON.parse(readFileSync(allowlistPath, "utf8"))
  : allowlistJson
    ? JSON.parse(allowlistJson)
    : fallbackEntry.user
      ? [fallbackEntry]
      : [];

if (allowlist.length === 0) {
  throw new Error("Set PROOF_USER, ALLOWLIST_JSON, or ALLOWLIST_PATH in .env.");
}

const target = {
  user: process.env.PROOF_USER ?? allowlist[0].user,
  itemId: process.env.PROOF_ITEM_ID ?? allowlist[0].itemId,
  enhancementType:
    process.env.PROOF_ENHANCEMENT_TYPE ?? allowlist[0].enhancementType
};

function leafOf({ user, itemId, enhancementType }) {
  return ethers.solidityPackedKeccak256(
    ["bytes"],
    [
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256", "uint8"],
        [user, itemId, enhancementType]
      )
    ]
  );
}

function hashPair(a, b) {
  const [left, right] = BigInt(a) < BigInt(b) ? [a, b] : [b, a];
  return ethers.solidityPackedKeccak256(["bytes32", "bytes32"], [left, right]);
}

function buildLayers(leaves) {
  if (leaves.length === 0) {
    return [[ethers.ZeroHash]];
  }

  const layers = [[...leaves].sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1))];

  while (layers.at(-1).length > 1) {
    const current = layers.at(-1);
    const next = [];

    for (let i = 0; i < current.length; i += 2) {
      next.push(i + 1 < current.length ? hashPair(current[i], current[i + 1]) : current[i]);
    }

    layers.push(next);
  }

  return layers;
}

function getProof(layers, leaf) {
  const proof = [];
  let index = layers[0].indexOf(leaf);

  if (index === -1) {
    throw new Error("Target leaf is not in allowlist");
  }

  for (let layerIndex = 0; layerIndex < layers.length - 1; layerIndex++) {
    const layer = layers[layerIndex];
    const pairIndex = index % 2 === 0 ? index + 1 : index - 1;

    if (pairIndex < layer.length) {
      proof.push(layer[pairIndex]);
    }

    index = Math.floor(index / 2);
  }

  return proof;
}

const leaves = allowlist.map(leafOf);
const targetLeaf = leafOf(target);
const layers = buildLayers(leaves);
const root = layers.at(-1)[0];
const proof = getProof(layers, targetLeaf);

console.log("target:", target);
console.log("leaf:", targetLeaf);
console.log("merkleRoot:", root);
console.log("MERKLE_PROOF=" + JSON.stringify(proof));

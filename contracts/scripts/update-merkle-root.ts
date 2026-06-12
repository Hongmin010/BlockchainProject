import { network } from "hardhat";
import fs from "fs";
import { AbiCoder, keccak256, concat, getAddress } from "ethers";

const DEPLOYED_ADDRESSES_PATH =
  "./ignition/deployments/chain-84532/deployed_addresses.json";

const OUTPUT_CLAIMS_PATH = "./merkle-claims.baseSepolia.json";

const abiCoder = AbiCoder.defaultAbiCoder();

type AllowEntry = {
  user: string;
  itemId: bigint;
  enhancementType: number;
};

const MY_ADDRESS = "0x76491a444fea8b6c7dc1e12a973631b99f0f1ec9";
const TEAMMATE_ADDRESS = "0x9A7F7f7e990474659211526fCa723F46d0E89AFF";
const NEW_TEAMMATE_ADDRESS = "0x5735fC88D65061b16F580A2732d22b3306D336B8";

function createAllowList(): AllowEntry[] {
  const list: AllowEntry[] = [];

  // 기존 네 테스트 권한 유지
  list.push({
    user: MY_ADDRESS,
    itemId: 2n,
    enhancementType: 0,
  });

  // 팀원에게 itemId 1~100 강화 권한 부여
  for (let itemId = 1; itemId <= 100; itemId++) {
    list.push({
      user: TEAMMATE_ADDRESS,
      itemId: BigInt(itemId),
      enhancementType: 0,
    });
  }
  
  for (let itemId = 1; itemId <= 100; itemId++) {
    list.push({
      user: NEW_TEAMMATE_ADDRESS,
      itemId: BigInt(itemId),
      enhancementType: 0,
    });
  }

  return list;
}

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

// Solidity의 keccak256(abi.encode(user, itemId, enhancementType))와 동일
function getLeaf(entry: AllowEntry): string {
  const encoded = abiCoder.encode(
    ["address", "uint256", "uint8"],
    [getAddress(entry.user), entry.itemId, entry.enhancementType]
  );

  return keccak256(encoded);
}

// contracts/contracts/MerkleProof.sol의 sorted pair hash 방식과 동일
function hashPair(a: string, b: string): string {
  const aBig = BigInt(a);
  const bBig = BigInt(b);

  const [left, right] = aBig <= bBig ? [a, b] : [b, a];

  return keccak256(concat([left, right]));
}

function buildTree(leaves: string[]): string[][] {
  if (leaves.length === 0) {
    throw new Error("Allow list is empty");
  }

  const tree: string[][] = [leaves];

  while (tree[tree.length - 1].length > 1) {
    const currentLevel = tree[tree.length - 1];
    const nextLevel: string[] = [];

    for (let i = 0; i < currentLevel.length; i += 2) {
      if (i + 1 < currentLevel.length) {
        nextLevel.push(hashPair(currentLevel[i], currentLevel[i + 1]));
      } else {
        // 홀수 개면 마지막 노드는 그대로 올림
        nextLevel.push(currentLevel[i]);
      }
    }

    tree.push(nextLevel);
  }

  return tree;
}

function getRoot(tree: string[][]): string {
  return tree[tree.length - 1][0];
}

function getProof(tree: string[][], leafIndex: number): string[] {
  const proof: string[] = [];
  let index = leafIndex;

  for (let level = 0; level < tree.length - 1; level++) {
    const currentLevel = tree[level];
    const siblingIndex = index % 2 === 0 ? index + 1 : index - 1;

    if (siblingIndex < currentLevel.length) {
      proof.push(currentLevel[siblingIndex]);
    }

    index = Math.floor(index / 2);
  }

  return proof;
}

async function main() {
  const { ethers } = await network.connect();

  const [signer] = await ethers.getSigners();
  const contractAddress = getDeployedContractAddress();

  console.log("Owner:", signer.address);
  console.log("Contract:", contractAddress);

  const game = await ethers.getContractAt(
    "EnhancementGameVRF",
    contractAddress,
    signer
  );

  const currentOwner = await game.owner();
  console.log("Contract owner:", currentOwner);

  if (currentOwner.toLowerCase() !== signer.address.toLowerCase()) {
    throw new Error("This signer is not the contract owner");
  }

  const allowList = createAllowList();
  const leaves = allowList.map(getLeaf);
  const tree = buildTree(leaves);
  const root = getRoot(tree);

  console.log("\nAllow list count:", allowList.length);
  console.log("New Merkle Root:", root);

  const claims = allowList.map((entry, index) => ({
    user: getAddress(entry.user),
    itemId: entry.itemId.toString(),
    enhancementType: entry.enhancementType.toString(),
    leaf: leaves[index],
    proof: getProof(tree, index),
  }));

  console.log("\nSetting merkleRoot...");
  const tx = await game.setMerkleRoot(root);
  console.log("setMerkleRoot tx:", tx.hash);

  const receipt = await tx.wait(1);
  console.log("setMerkleRoot status:", receipt?.status);

  if (receipt?.status !== 1) {
    throw new Error("setMerkleRoot transaction failed");
  }

  const updatedRoot = await game.merkleRoot();
  console.log("Updated merkleRoot:", updatedRoot);

  if (updatedRoot.toLowerCase() !== root.toLowerCase()) {
    throw new Error(
      `Merkle root mismatch. expected=${root}, actual=${updatedRoot}`
    );
  }

  console.log("\nVerifying all claims on-chain...");
  for (let i = 0; i < allowList.length; i++) {
    const entry = allowList[i];
    const proof = getProof(tree, i);

    const valid = await game.isValidEnhancementProof(
      getAddress(entry.user),
      entry.itemId,
      entry.enhancementType,
      proof
    );

    if (!valid) {
      throw new Error(
        `Invalid proof: user=${getAddress(entry.user)}, itemId=${entry.itemId.toString()}, type=${entry.enhancementType}`
      );
    }
  }

  console.log("All claims are valid.");

  fs.writeFileSync(
    OUTPUT_CLAIMS_PATH,
    JSON.stringify(
      {
        merkleRoot: root,
        contractAddress,
        network: "Base Sepolia",
        chainId: 84532,
        claims,
      },
      null,
      2
    )
  );

  console.log("Claims written to:", OUTPUT_CLAIMS_PATH);

  const teammateClaims = claims.filter(
    (claim) => claim.user.toLowerCase() === TEAMMATE_ADDRESS.toLowerCase()
  );

  console.log("\nTeammate sample proofs:");
  console.log("itemId 1:");
  console.log(JSON.stringify(teammateClaims[0], null, 2));

  console.log("\nitemId 100:");
  console.log(JSON.stringify(teammateClaims[99], null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
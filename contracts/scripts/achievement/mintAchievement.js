import { ethers } from "ethers";
import dotenv from "dotenv";

dotenv.config();

if (!process.env.PRIVATE_KEY) {
  throw new Error("PRIVATE_KEY is missing in .env");
}

if (!process.env.ACHIEVEMENT_CONTRACT_ADDRESS) {
  throw new Error("ACHIEVEMENT_CONTRACT_ADDRESS is missing in .env");
}

if (!process.env.AWARD_TO) {
  throw new Error("AWARD_TO is missing in .env");
}

if (!process.env.TOKEN_ID && !process.env.ACHIEVEMENT_ID) {
  throw new Error("TOKEN_ID is missing in .env");
}

if (!process.env.DATA_HASH) {
  throw new Error("DATA_HASH is missing in .env");
}

const provider = new ethers.JsonRpcProvider(
  process.env.RPC_URL ??
    process.env.BASE_SEPOLIA_RPC_URL ??
    "https://sepolia.base.org",
);
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

const achievementAddress = process.env.ACHIEVEMENT_CONTRACT_ADDRESS;
const awardTo = ethers.getAddress(process.env.AWARD_TO);
const tokenId = BigInt(process.env.TOKEN_ID ?? process.env.ACHIEVEMENT_ID);
const dataHash = process.env.DATA_HASH;

const abi = [
  "function mintAchievement(address user, uint256 tokenId, bytes32 dataHash) external",
  "function hasAchievement(address user, uint256 tokenId) external view returns (bool)",
  "function achievementDataHash(address user, uint256 tokenId) external view returns (bytes32)",
  "function minters(address minter) external view returns (bool)",
  "function owner() external view returns (address)",
  "event AchievementMinted(address indexed user, uint256 indexed tokenId, bytes32 indexed dataHash, address minter)",
];

const achievements = new ethers.Contract(achievementAddress, abi, wallet);

console.log("caller:", wallet.address);
console.log("achievement contract:", achievementAddress);
console.log("award to:", awardTo);
console.log("token id:", tokenId.toString());
console.log("data hash:", dataHash);

const owner = await achievements.owner();
const isMinter = await achievements.minters(wallet.address);

if (!isMinter && owner.toLowerCase() !== wallet.address.toLowerCase()) {
  throw new Error("Caller is not owner or registered minter");
}

const alreadyClaimed = await achievements.hasAchievement(
  awardTo,
  tokenId,
);

if (alreadyClaimed) {
  const storedHash = await achievements.achievementDataHash(
    awardTo,
    tokenId,
  );
  console.log("achievement already minted");
  console.log("stored data hash:", storedHash);
  process.exit(0);
}

const tx = await achievements.mintAchievement(
  awardTo,
  tokenId,
  dataHash,
);

console.log("tx:", tx.hash);

const receipt = await tx.wait();
console.log("confirmed block:", receipt.blockNumber);
console.log(
  "stored data hash:",
  await achievements.achievementDataHash(awardTo, tokenId),
);

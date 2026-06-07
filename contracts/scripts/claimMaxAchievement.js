import { ethers } from "ethers";
import dotenv from "dotenv";

dotenv.config();

if (!process.env.PRIVATE_KEY) {
  throw new Error("PRIVATE_KEY is missing in .env");
}

if (!process.env.ACHIEVEMENT_CONTRACT_ADDRESS) {
  throw new Error("ACHIEVEMENT_CONTRACT_ADDRESS is missing in .env");
}

const provider = new ethers.JsonRpcProvider(
  process.env.RPC_URL ?? process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org",
);
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

const achievementAddress = process.env.ACHIEVEMENT_CONTRACT_ADDRESS;
const itemId = BigInt(process.env.ITEM_ID ?? "1");
const awardTo = process.env.AWARD_TO;

const abi = [
  "function claimMaxEnhancement(uint256 itemId) external",
  "function awardMaxEnhancement(address user, uint256 itemId) external",
  "function hasAchievement(address user, uint256 achievementId) external view returns (bool)",
  "function MAX_ENHANCEMENT_ACHIEVEMENT_ID() external view returns (uint256)",
  "event AchievementClaimed(address indexed user, uint256 indexed achievementId, uint256 indexed itemId)",
];

const achievements = new ethers.Contract(achievementAddress, abi, wallet);
const achievementId = await achievements.MAX_ENHANCEMENT_ACHIEVEMENT_ID();
const targetUser = awardTo ?? wallet.address;

console.log("caller:", wallet.address);
console.log("achievement contract:", achievementAddress);
console.log("target user:", targetUser);
console.log("item id:", itemId.toString());

const alreadyClaimed = await achievements.hasAchievement(
  targetUser,
  achievementId,
);

if (alreadyClaimed) {
  console.log("max enhancement achievement already claimed");
  process.exit(0);
}

const tx = awardTo
  ? await achievements.awardMaxEnhancement(awardTo, itemId)
  : await achievements.claimMaxEnhancement(itemId);

console.log("tx:", tx.hash);

const receipt = await tx.wait();
console.log("confirmed block:", receipt.blockNumber);

const claimedEvent = receipt.logs
  .map((log) => {
    try {
      return achievements.interface.parseLog(log);
    } catch {
      return null;
    }
  })
  .find((event) => event?.name === "AchievementClaimed");

if (claimedEvent) {
  console.log("achievement id:", claimedEvent.args.achievementId.toString());
}

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
const itemId = BigInt(process.env.ITEM_ID ?? "72");

const abi = [
  "function claimSuccessStreak(uint256 itemId) external",
  "function hasAchievement(address user, uint256 achievementId) external view returns (bool)",
  "function canClaimSuccessStreak(address user, uint256 itemId) external view returns (bool)",
  "function SUCCESS_STREAK_ACHIEVEMENT_ID() external view returns (uint256)",
  "function SUCCESS_STREAK_THRESHOLD() external view returns (uint8)",
  "event AchievementClaimed(address indexed user, uint256 indexed achievementId, uint256 indexed itemId, uint8 totalLevel)",
];

const achievements = new ethers.Contract(achievementAddress, abi, wallet);
const achievementId = await achievements.SUCCESS_STREAK_ACHIEVEMENT_ID();

console.log("caller:", wallet.address);
console.log("achievement contract:", achievementAddress);
console.log("item id:", itemId.toString());
console.log(
  "required success streak:",
  (await achievements.SUCCESS_STREAK_THRESHOLD()).toString(),
);

const alreadyClaimed = await achievements.hasAchievement(
  wallet.address,
  achievementId,
);

if (alreadyClaimed) {
  console.log("success streak achievement already claimed");
  process.exit(0);
}

const canClaim = await achievements.canClaimSuccessStreak(
  wallet.address,
  itemId,
);

if (!canClaim) {
  throw new Error(
    `Success streak achievement is not claimable for item ${itemId.toString()}`,
  );
}

const tx = await achievements.claimSuccessStreak(itemId);

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
  console.log("total level:", claimedEvent.args.totalLevel.toString());
}

import { ethers } from "ethers";
import dotenv from "dotenv";

dotenv.config();

if (!process.env.PRIVATE_KEY) {
  throw new Error("PRIVATE_KEY is missing in .env");
}

if (!process.env.CONTRACT_ADDRESS) {
  throw new Error("CONTRACT_ADDRESS is missing in .env");
}

if (!process.env.ACHIEVEMENT_CONTRACT_ADDRESS) {
  throw new Error("ACHIEVEMENT_CONTRACT_ADDRESS is missing in .env");
}

const provider = new ethers.JsonRpcProvider(
  process.env.RPC_URL ?? process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org",
);
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

const enhancementAddress = process.env.CONTRACT_ADDRESS;
const achievementAddress = process.env.ACHIEVEMENT_CONTRACT_ADDRESS;

const enhancementAbi = [
  "function achievementContract() external view returns (address)",
  "function setAchievementContract(address newAchievementContract) external",
];

const achievementAbi = [
  "function owner() external view returns (address)",
  "function transferOwnership(address newOwner) external",
];

const enhancement = new ethers.Contract(
  enhancementAddress,
  enhancementAbi,
  wallet,
);
const achievement = new ethers.Contract(
  achievementAddress,
  achievementAbi,
  wallet,
);

console.log("caller:", wallet.address);
console.log("enhancement contract:", enhancementAddress);
console.log("achievement contract:", achievementAddress);

const currentAchievementContract = await enhancement.achievementContract();

if (currentAchievementContract.toLowerCase() !== achievementAddress.toLowerCase()) {
  const tx = await enhancement.setAchievementContract(achievementAddress);
  console.log("setAchievementContract tx:", tx.hash);
  await tx.wait();
} else {
  console.log("enhancement contract already linked");
}

const currentOwner = await achievement.owner();

if (currentOwner.toLowerCase() !== enhancementAddress.toLowerCase()) {
  const tx = await achievement.transferOwnership(enhancementAddress);
  console.log("transferOwnership tx:", tx.hash);
  await tx.wait();
} else {
  console.log("achievement contract owner already transferred");
}

console.log("auto achievement setup complete");

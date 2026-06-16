import { AbiCoder, getAddress, keccak256 } from "ethers";
import { ACHIEVEMENT_PAYLOAD_TYPES } from "../constants/achievements.js";

const vector = {
  wallet: "0xAbcDef0123456789abCdef0123456789ABCDEF01",
  achievementId: 4n,
  evidenceA: 31n,
  evidenceB: 40n,
  fromBlock: 26000000n,
  toBlock: 26123456n,
};

const wallet = getAddress(vector.wallet.toLowerCase()).toLowerCase();
const values = [
  wallet,
  vector.achievementId,
  vector.evidenceA,
  vector.evidenceB,
  vector.fromBlock,
  vector.toBlock,
];

const encoded = AbiCoder.defaultAbiCoder().encode(
  ACHIEVEMENT_PAYLOAD_TYPES,
  values,
);
const dataHash = keccak256(encoded);

console.log("wallet:", wallet);
console.log("achievementId:", vector.achievementId.toString());
console.log("evidenceA:", vector.evidenceA.toString());
console.log("evidenceB:", vector.evidenceB.toString());
console.log("fromBlock:", vector.fromBlock.toString());
console.log("toBlock:", vector.toBlock.toString());
console.log("abi.encode bytes:", encoded);
console.log("dataHash:", dataHash);

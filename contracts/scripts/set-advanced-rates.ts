import { network } from "hardhat";

const ADVANCED_CONTRACT_ADDRESS = "0x4f1c8573446efc5ae48eb453cfc66fafe26c2f5c";

type RateConfig = {
  mode: number;
  extraLevel: number;
  successRateBps: number;
  destroyRateBps: number;
  label: string;
};

// mode 0 = Safe
// mode 1 = Risky
const RATES: RateConfig[] = [
  // Safe: 파괴 없음, 실패 시 하락, 2회 하락 후 보장 성공
  {
    mode: 0,
    extraLevel: 0,
    successRateBps: 7500,
    destroyRateBps: 0,
    label: "Safe 5 -> 6",
  },
  {
    mode: 0,
    extraLevel: 1,
    successRateBps: 6500,
    destroyRateBps: 0,
    label: "Safe 6 -> 7",
  },
  {
    mode: 0,
    extraLevel: 2,
    successRateBps: 5500,
    destroyRateBps: 0,
    label: "Safe 7 -> 8",
  },
  {
    mode: 0,
    extraLevel: 3,
    successRateBps: 4500,
    destroyRateBps: 0,
    label: "Safe 8 -> 9",
  },
  {
    mode: 0,
    extraLevel: 4,
    successRateBps: 3500,
    destroyRateBps: 0,
    label: "Safe 9 -> 10",
  },

  // Risky: 성공률 높음, 실패 유지 10%, 파괴 시 5강 복귀
  {
    mode: 1,
    extraLevel: 0,
    successRateBps: 7000,
    destroyRateBps: 2000,
    label: "Risky 5 -> 6",
  },
  {
    mode: 1,
    extraLevel: 1,
    successRateBps: 6500,
    destroyRateBps: 2500,
    label: "Risky 6 -> 7",
  },
  {
    mode: 1,
    extraLevel: 2,
    successRateBps: 6000,
    destroyRateBps: 3000,
    label: "Risky 7 -> 8",
  },
  {
    mode: 1,
    extraLevel: 3,
    successRateBps: 5500,
    destroyRateBps: 3500,
    label: "Risky 8 -> 9",
  },
  {
    mode: 1,
    extraLevel: 4,
    successRateBps: 5000,
    destroyRateBps: 4000,
    label: "Risky 9 -> 10",
  },
];

async function main() {
  const { ethers } = await network.connect();

  const [signer] = await ethers.getSigners();

  const advancedGame = await ethers.getContractAt(
    "AdvancedEnhancementGameVRF",
    ADVANCED_CONTRACT_ADDRESS,
    signer
  );

  const owner = await advancedGame.owner();

  console.log("Caller:", signer.address);
  console.log("Owner:", owner);
  console.log("Advanced contract:", ADVANCED_CONTRACT_ADDRESS);

  if (owner.toLowerCase() !== signer.address.toLowerCase()) {
    throw new Error("Caller is not the owner");
  }

  for (const rate of RATES) {
    const oldRate = await advancedGame.advancedRates(
      rate.mode,
      rate.extraLevel
    );

    console.log("");
    console.log(`Updating ${rate.label}`);
    console.log(
      `Old: success=${oldRate.successRateBps.toString()}, destroy=${oldRate.destroyRateBps.toString()}`
    );
    console.log(
      `New: success=${rate.successRateBps}, destroy=${rate.destroyRateBps}`
    );

    const tx = await advancedGame.setAdvancedRate(
      rate.mode,
      rate.extraLevel,
      rate.successRateBps,
      rate.destroyRateBps
    );

    console.log("tx:", tx.hash);

    const receipt = await tx.wait(1);

    if (receipt?.status !== 1) {
      throw new Error(`setAdvancedRate failed: ${rate.label}`);
    }

    const newRate = await advancedGame.advancedRates(
      rate.mode,
      rate.extraLevel
    );

    console.log(
      `Updated: success=${newRate.successRateBps.toString()}, destroy=${newRate.destroyRateBps.toString()}`
    );
  }

  console.log("");
  console.log("All advanced rates updated.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
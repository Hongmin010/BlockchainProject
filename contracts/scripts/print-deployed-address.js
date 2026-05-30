import { readFileSync } from "node:fs";

const deployedAddresses = JSON.parse(
  readFileSync("ignition/deployments/chain-84532/deployed_addresses.json", "utf8")
);

const address = deployedAddresses["EnhancementGameVRFModule#EnhancementGameVRF"];

if (!address) {
  throw new Error("EnhancementGameVRF deployment address not found");
}

console.log(address);

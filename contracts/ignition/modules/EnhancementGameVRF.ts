import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

const EnhancementGameVRFModule = buildModule("EnhancementGameVRFModule", (m) => {
  const subscriptionId = m.getParameter("subscriptionId");

  const enhancementGame = m.contract("EnhancementGameVRF", [subscriptionId]);

  return { enhancementGame };
});

export default EnhancementGameVRFModule;
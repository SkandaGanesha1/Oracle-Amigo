import { localAgentClient } from "./localAgentClient";
import type { BiometricCapability } from "./types";

export const biometricApi = {
  capability: () => localAgentClient.get<BiometricCapability>("/biometric/capability")
};

import * as fsp from "node:fs/promises";
import path from "node:path";
import { validateCloudControlCutover } from "./cloud-control-cutover-validate";

export async function validateCutoverOutput(profileRoot: string): Promise<string[]> {
  const file = path.join(profileRoot, "cloud-cutover-evidence.json");
  if (!(await exists(file))) return [];
  const evidence = JSON.parse(await fsp.readFile(file, "utf8"));
  const expectedImageBuildIdentity = String(
    evidence.expectedImageBuildIdentity || evidence.imagePublication?.imageBuildIdentity || "",
  );
  return validateCloudControlCutover(evidence, {
    operation: "cutover",
    expectedHostProfile: String(evidence.hostProfile || ""),
    expectedImageBuildIdentity,
    expectedRegion: String(evidence.region || "") || undefined,
    selectedCapabilities: evidence.selectedProviderCapabilities || [],
    maxAgeMinutes: 1440,
  }).errors;
}

async function exists(file: string): Promise<boolean> {
  return await fsp
    .access(file)
    .then(() => true)
    .catch(() => false);
}

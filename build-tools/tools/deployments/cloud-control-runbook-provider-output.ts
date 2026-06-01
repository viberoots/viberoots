import * as fsp from "node:fs/promises";
import path from "node:path";
import { validateProviderCapabilityHookEvidenceShape } from "./cloud-control-provider-capability-hook-contract";

export async function validateProviderCapabilityRunbookOutput(
  profileRoot: string,
  file: string,
): Promise<string[]> {
  const name = file.slice("$PROFILE_ROOT/provider-capability-".length, -".json".length);
  const localPath = path.join(profileRoot, `provider-capability-${name}.json`);
  if (!(await exists(localPath))) return [];
  const [evidence, topology] = await Promise.all([
    readJson(localPath),
    readJson(path.join(profileRoot, "aws-topology-evidence.json")),
  ]);
  return validateProviderCapabilityHookEvidenceShape(name, evidence, {
    allowedPhases: ["evidence"],
    expectedAwsTopology: topology,
  });
}

async function readJson(file: string): Promise<any> {
  try {
    return JSON.parse(await fsp.readFile(file, "utf8"));
  } catch {
    return undefined;
  }
}

async function exists(file: string): Promise<boolean> {
  return await fsp
    .access(file)
    .then(() => true)
    .catch(() => false);
}

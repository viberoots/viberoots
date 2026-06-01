import * as fsp from "node:fs/promises";
import path from "node:path";
import { validateProviderCapabilityHookEvidenceShape } from "./cloud-control-provider-capability-hook-contract";

export async function validateProviderCapabilityRunbookOutput(
  profileRoot: string,
  file: string,
): Promise<string[]> {
  const output = providerCapabilityOutput(file);
  const localPath = path.join(profileRoot, `provider-capability-${output.name}.json`);
  if (!(await exists(localPath))) return [];
  const [evidence, topology] = await Promise.all([
    readJson(localPath),
    readJson(path.join(profileRoot, "aws-topology-evidence.json")),
  ]);
  return validateProviderCapabilityHookEvidenceShape(output.capabilityId, evidence, {
    allowedPhases: [output.phase],
    expectedAwsTopology: topology,
  });
}

function providerCapabilityOutput(file: string): {
  name: string;
  capabilityId: string;
  phase: "preview" | "apply" | "evidence";
} {
  const name = file.slice("$PROFILE_ROOT/provider-capability-".length, -".json".length);
  if (name.endsWith("-preview")) {
    return { name, capabilityId: name.slice(0, -"-preview".length), phase: "preview" };
  }
  if (name.endsWith("-apply")) {
    return { name, capabilityId: name.slice(0, -"-apply".length), phase: "apply" };
  }
  return { name, capabilityId: name, phase: "evidence" };
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

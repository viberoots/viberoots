import * as fsp from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import {
  type RuntimeHttpCheck,
  validateRuntimeHttpEvidence,
} from "./cloud-control-runtime-http-evidence";

const OUTPUTS: Record<string, RuntimeHttpCheck> = {
  "$PROFILE_ROOT/http-health.json": "health",
  "$PROFILE_ROOT/http-readiness.json": "readiness",
  "$PROFILE_ROOT/http-worker-heartbeats.json": "worker-heartbeats",
};

export async function validateRuntimeHttpOutput(
  profileRoot: string,
  file: string,
): Promise<string[]> {
  const check = OUTPUTS[file];
  if (!check) return [];
  const localPath = path.join(profileRoot, file.slice("$PROFILE_ROOT/".length));
  if (!(await exists(localPath))) return [];
  const [evidence, config, topology] = await Promise.all([
    readJson(localPath),
    readYaml(path.join(profileRoot, "config.yaml")),
    readJson(path.join(profileRoot, "aws-topology-evidence.json")),
  ]);
  return validateRuntimeHttpEvidence(evidence, check, {
    expectedPublicUrl: String(config?.service?.publicUrl || ""),
    expectedHostProfile: "aws-ec2",
    expectedProfileIdentity: String(topology?.compute?.instanceId || config?.instanceId || ""),
    expectedWorkerCount: expectedWorkerCount(config),
    maxAgeMinutes: 1440,
  });
}

function expectedWorkerCount(config: any): number {
  const count = Number(config?.workers?.expectedCount);
  return Number.isFinite(count) && count > 0 ? count : 1;
}

async function exists(file: string): Promise<boolean> {
  return await fsp
    .access(file)
    .then(() => true)
    .catch(() => false);
}

async function readJson(file: string): Promise<any> {
  return JSON.parse(await fsp.readFile(file, "utf8"));
}

async function readYaml(file: string): Promise<any> {
  return YAML.parse(await fsp.readFile(file, "utf8"));
}

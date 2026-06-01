import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import YAML from "yaml";

export function liveCapabilityIds(): string[] {
  return (process.env.VBR_CLOUD_PROVIDER_CAPABILITY_LIVE_IDS || "aws-ec2-control-plane-host")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

export function requiredLiveEnv(name: string): string {
  const value = process.env[name]?.trim();
  assert.ok(value, `${name} is required when live provider capability hooks are enabled`);
  return value;
}

export async function liveProviderInputs(capabilityId: string) {
  if (capabilityId !== "aws-ec2-control-plane-host") return {};
  const topologyFile = requiredLiveEnv("VBR_CLOUD_PROVIDER_CAPABILITY_LIVE_AWS_TOPOLOGY_FILE");
  const profileFile = requiredLiveEnv("VBR_CLOUD_PROVIDER_CAPABILITY_LIVE_AWS_EC2_PROFILE_FILE");
  return {
    awsTopologyEvidence: JSON.parse(await fsp.readFile(topologyFile, "utf8")),
    awsEc2Profile: YAML.parse(await fsp.readFile(profileFile, "utf8")),
  };
}

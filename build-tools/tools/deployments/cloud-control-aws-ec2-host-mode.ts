export const EC2_HOST_MODES = ["external-reviewed-host", "repo-owned-asg"] as const;

export type Ec2HostMode = (typeof EC2_HOST_MODES)[number];

export const DEFAULT_EC2_HOST_MODE: Ec2HostMode = "external-reviewed-host";

export function normalizeEc2HostMode(value: unknown): Ec2HostMode {
  return EC2_HOST_MODES.includes(value as Ec2HostMode)
    ? (value as Ec2HostMode)
    : DEFAULT_EC2_HOST_MODE;
}

export function ec2HostModeFromProfile(profile: unknown): Ec2HostMode {
  return normalizeEc2HostMode((profile as Record<string, unknown> | undefined)?.ec2HostMode);
}

export function ec2HostModeFromTopology(topology: unknown): Ec2HostMode | undefined {
  const value = (topology as Record<string, unknown> | undefined)?.ec2HostMode;
  return EC2_HOST_MODES.includes(value as Ec2HostMode) ? (value as Ec2HostMode) : undefined;
}

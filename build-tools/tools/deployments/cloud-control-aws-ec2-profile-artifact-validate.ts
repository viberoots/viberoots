import YAML from "yaml";

const CONFIG = "/etc/deployment-control-plane/config.yaml";
const CREDS = "/run/deployment-control-plane/credentials";
const STATE = "/var/lib/deployment-control-plane";

export function validateAwsEc2SystemdArtifacts(files: Record<string, string>): string[] {
  const profile = YAML.parse(files["aws-ec2-profile.yaml"] || "") as any;
  const processes = Array.isArray(profile?.processes) ? profile.processes : [];
  const errors: string[] = [];
  if (profile?.credentialMountWiring?.mode !== "bind-mounted-credential-directory") {
    errors.push("AWS profile credential mount wiring is stale");
  }
  if (
    profile?.credentialMountWiring?.target !== CREDS ||
    profile?.credentialMountWiring?.readOnly !== true
  ) {
    errors.push("AWS profile credential mount must target read-only credential directory");
  }
  for (const process of processes) {
    const unitName = String(process?.systemdUnit || "");
    const raw = files[`systemd/${unitName}`];
    if (!raw) {
      errors.push(`${process?.name || unitName || "AWS process"} missing generated systemd unit`);
      continue;
    }
    if (!raw.includes(`${CONFIG}:${CONFIG}:ro`)) {
      errors.push(`${unitName} config mount must be read-only`);
    }
    if (!raw.includes(`${CREDS}:${CREDS}:ro`)) {
      errors.push(`${unitName} credential mount must be read-only`);
    }
    for (const statePath of [`${STATE}/records`, `${STATE}/artifacts`, `${STATE}/runtime`]) {
      if (!raw.includes(`${statePath}:${statePath}:rw`)) {
        errors.push(`${unitName} missing writable persistent mount ${statePath}`);
      }
    }
  }
  return errors;
}

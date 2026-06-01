import YAML from "yaml";

const CONFIG = "/etc/deployment-control-plane/config.yaml";
const CREDS = "/run/deployment-control-plane/credentials";
const STATE = "/var/lib/deployment-control-plane";
const SERVICE_PORT = 7780;

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
  errors.push(...validateArtifactIamBinding(profile));
  errors.push(...validateServiceIngress(profile));
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
    if (process?.role === "service") {
      const bindHost = String(process?.serviceBindHost || "");
      const servicePort = Number(process?.servicePort || SERVICE_PORT);
      if (isLoopbackBind(bindHost)) {
        errors.push(`${unitName} service ingress bind must be load-balancer reachable`);
      }
      if (!raw.includes(`--publish ${bindHost}:${servicePort}:${SERVICE_PORT}`)) {
        errors.push(`${unitName} service ingress publish does not match generated profile`);
      }
    } else if (raw.includes("--publish")) {
      errors.push(`${unitName} worker unit must not publish ingress ports`);
    }
  }
  return errors;
}

function validateArtifactIamBinding(profile: Record<string, any>): string[] {
  const artifact = profile?.artifactBackend || {};
  if (artifact.credentialMode !== "aws-instance-profile") return [];
  const binding = artifact.instanceProfileBinding || {};
  const errors: string[] = [];
  if (binding.instanceProfileArn !== profile?.compute?.instanceProfileArn) {
    errors.push("AWS profile artifact IAM binding instance profile does not match compute profile");
  }
  if (!binding.roleArn || binding.roleArn !== artifact.iamRoleArn) {
    errors.push("AWS profile artifact IAM binding role does not match reviewed role");
  }
  if (!binding.expectedRoleArn || binding.expectedRoleArn !== artifact.iamRoleArn) {
    errors.push("AWS profile artifact IAM binding expected role does not match reviewed role");
  }
  if (!String(binding.trustDigest || "").startsWith("sha256:")) {
    errors.push("AWS profile artifact IAM binding missing reviewed trust digest");
  }
  if (!String(artifact.leastPrivilegePolicyDigest || "").startsWith("sha256:")) {
    errors.push("AWS profile artifact IAM binding missing least-privilege policy digest");
  }
  if (
    !String(binding.leastPrivilegePolicyDigest || "").startsWith("sha256:") ||
    binding.leastPrivilegePolicyDigest !== artifact.leastPrivilegePolicyDigest
  ) {
    errors.push(
      "AWS profile artifact IAM binding least-privilege policy does not match reviewed policy",
    );
  }
  if (
    !Array.isArray(binding.policyDigests) ||
    !binding.policyDigests.includes(artifact.leastPrivilegePolicyDigest)
  ) {
    errors.push("AWS profile artifact IAM binding missing attached artifact policy digest");
  }
  return errors;
}

function validateServiceIngress(profile: Record<string, any>): string[] {
  const ingress = profile?.network?.serviceIngress || {};
  const errors: string[] = [];
  if (ingress.process !== "deployment-control-plane-service") {
    errors.push("AWS profile service ingress must target the service process");
  }
  if (ingress.systemdUnit !== "deployment-control-plane-service.service") {
    errors.push("AWS profile service ingress must target the service unit");
  }
  if (isLoopbackBind(String(ingress.bindHost || ""))) {
    errors.push("AWS profile service ingress bind must be load-balancer reachable");
  }
  if (Number(ingress.bindPort) !== SERVICE_PORT || Number(ingress.containerPort) !== SERVICE_PORT) {
    errors.push("AWS profile service ingress port must match control-plane service port");
  }
  if (!ingress.serviceSecurityGroupId || !ingress.loadBalancerSecurityGroupId) {
    errors.push("AWS profile service ingress missing reviewed security-group binding");
  }
  if (
    !Array.isArray(ingress.sourceSecurityGroupIds) ||
    ingress.sourceSecurityGroupIds.length === 0
  ) {
    errors.push("AWS profile service ingress missing reviewed source security-group binding");
  }
  if (!ingress.targetGroupArn) {
    errors.push("AWS profile service ingress missing target group identity");
  }
  return errors;
}

function isLoopbackBind(value: string): boolean {
  return !value || value === "127.0.0.1" || value === "localhost" || value === "::1";
}

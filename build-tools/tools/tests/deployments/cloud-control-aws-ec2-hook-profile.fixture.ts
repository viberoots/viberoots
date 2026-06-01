export function awsEc2HookProfile() {
  return {
    schemaVersion: "cloud-control-aws-ec2-profile@2",
    preferredHost: "nixos-ec2",
    compatibilityHost: "systemd-podman",
    network: {
      subnetIds: ["subnet-123", "subnet-456"],
      securityGroupIds: ["sg-service", "sg-worker"],
    },
    compute: {
      amiId: "ami-123",
      amiPinPath: "sha256:nixos-ami-import",
      instanceId: "i-0abc1234",
      launchTemplateId: "lt-123",
      launchTemplateVersion: "7",
      selectedSubnetIds: ["subnet-123", "subnet-456"],
      securityGroupIds: ["sg-service", "sg-worker"],
      instanceType: "m7i.large",
      instanceProfileArn: "arn:aws:iam::123456789012:instance-profile/control-plane",
      bootstrapDigest: "sha256:user",
      containerRuntime: "podman-systemd",
    },
    credentialMountWiring: { mode: "bind-mounted-credential-directory" },
    systemdUnits: [
      "deployment-control-plane-service.service",
      "deployment-control-plane-worker-1.service",
      "deployment-control-plane-worker-2.service",
    ],
  };
}

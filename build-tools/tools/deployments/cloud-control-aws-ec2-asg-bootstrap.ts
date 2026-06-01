import { createHash } from "node:crypto";

export const EC2_ASG_BOOTSTRAP_BUNDLE_PATH = "$PROFILE_ROOT/ec2-asg-bootstrap-user-data.sh";
export const EC2_ASG_BOOTSTRAP_FILE = "ec2-asg-bootstrap-user-data.sh";

export function ec2AsgBootstrapUserData(): string {
  return [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    "install -d -m 0755 /etc/deployment-control-plane",
    "install -d -m 0755 /var/lib/deployment-control-plane",
    "systemctl daemon-reload",
    "systemctl enable --now deployment-control-plane.service",
    "",
  ].join("\n");
}

export function ec2AsgBootstrapDigest(): string {
  return `sha256:${createHash("sha256").update(ec2AsgBootstrapUserData()).digest("hex")}`;
}

export function ec2BootstrapDigestForMode(mode: string | undefined, fallback: string | undefined) {
  return mode === "repo-owned-asg" ? ec2AsgBootstrapDigest() : fallback;
}

export function ec2AsgBootstrapBase64(): string {
  return Buffer.from(ec2AsgBootstrapUserData(), "utf8").toString("base64");
}

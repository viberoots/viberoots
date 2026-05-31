import type { CloudControlSetupInput } from "./cloud-control-setup-types";

export function renderResidualActionChecklist(input: CloudControlSetupInput): string {
  const actions = [
    {
      id: "auth-provider-import",
      title: "Auth Provider Import Evidence",
      phase: "local-review",
      type: "operator-evidence",
      action: "attach reviewed auth-provider import/provision evidence",
      evidence: "$PROFILE_ROOT/auth-provider-profile.json",
      output: "$PROFILE_ROOT/auth-provider-profile.json",
      evidenceRequirements: ["issuer", "audience", "jwks", "callback", "claims", "smoke"],
    },
    {
      id: "secret-backend-import",
      title: "Secret Backend Import Evidence",
      phase: "credential-preflight",
      type: "operator-evidence",
      action: "attach reviewed secret-backend references for every credential-map entry",
      evidence: "$PROFILE_ROOT/credential-map.json",
      output: "$PROFILE_ROOT/credential-map.json",
      evidenceRequirements: ["backend-ref", "least-privilege-scope", "rotation"],
    },
    {
      id: "credential-host-staging",
      title: "Credential Host Staging",
      phase: "credential-preflight",
      type: "operator-command",
      action: "stage mapped credential files on the host and run credential preflight",
      evidence: "$PROFILE_ROOT/credential-preflight.json",
      output: "$PROFILE_ROOT/credential-preflight.json",
      evidenceRequirements: ["manifest-files", "permissions", "redaction"],
    },
    ...(input.mode === "aws-ec2"
      ? [
          {
            id: "host-mount-wiring",
            title: "Host Mount Wiring",
            phase: "process-start",
            type: "operator-evidence",
            action: "verify generated systemd/Podman bind-mounted credential directory wiring",
            evidence: "$PROFILE_ROOT/aws-ec2-profile.yaml",
            output: "$PROFILE_ROOT/aws-ec2-profile.yaml",
            evidenceRequirements: ["bind-mounted-credential-directory"],
          },
        ]
      : []),
  ];
  return `${JSON.stringify({ schemaVersion: "cloud-control-residual-actions@1", actions }, null, 2)}\n`;
}

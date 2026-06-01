import type { CloudControlSetupInput } from "./cloud-control-setup-types";
import type { RunbookCommand } from "./cloud-control-runbook";
import { awsTopologyRequiredCapabilityIds } from "./cloud-control-aws-topology-capabilities";
import { setupAwsTopology } from "./cloud-control-setup-aws-topology";
import { rootPrelude } from "./cloud-control-runbook-root";

export function cutoverCommands(input: CloudControlSetupInput): RunbookCommand[] {
  const capabilities = awsTopologyRequiredCapabilityIds(input.awsTopology);
  const selected = capabilities.join(",");
  const expectedRegion = setupAwsTopology(input)?.region || input.artifactRegion || "";
  return [
    command(
      "cutover-evidence",
      `${rootPrelude(input.outDir)}; deployment-control-plane cutover-evidence --bundle-dir "$PROFILE_ROOT" --out "$PROFILE_ROOT/cloud-cutover-evidence.json"`,
      evidenceInputs(input, capabilities),
      ["$PROFILE_ROOT/cloud-cutover-evidence.json"],
      "cutover evidence is collected from setup outputs and provider evidence",
    ),
    command(
      "cutover-validate",
      `${rootPrelude(input.outDir)}; deployment-control-plane cutover --evidence "$PROFILE_ROOT/cloud-cutover-evidence.json" --expected-host-profile ${input.mode} --expected-image-build-identity ${input.expectedImageBuildIdentity} --expected-region ${expectedRegion} --selected-capability ${selected} --out "$PROFILE_ROOT/cloud-cutover-report.json"`,
      ["$PROFILE_ROOT/cloud-cutover-evidence.json"],
      ["$PROFILE_ROOT/cloud-cutover-report.json"],
      "protected/shared cutover validation passes",
    ),
  ];
}

function evidenceInputs(input: CloudControlSetupInput, capabilities: string[]): string[] {
  return [
    "$PROFILE_ROOT/config.yaml",
    "$PROFILE_ROOT/image-publication.json",
    "$PROFILE_ROOT/managed-dependency-evidence.json",
    "$PROFILE_ROOT/credential-staging.live.json",
    "$PROFILE_ROOT/aws-topology-evidence.json",
    "$PROFILE_ROOT/supabase-postgres.profile.json",
    "$PROFILE_ROOT/supabase-managed-postgres-evidence.json",
    "$PROFILE_ROOT/standby-evidence.json",
    "$PROFILE_ROOT/restore-evidence.json",
    "$PROFILE_ROOT/rollback-evidence.json",
    "$PROFILE_ROOT/break-glass-evidence.json",
    "$PROFILE_ROOT/latest-non-production-deployment.json",
    "$PROFILE_ROOT/ingress-dns-evidence.json",
    "$PROFILE_ROOT/ingress-tls-evidence.json",
    "$PROFILE_ROOT/ingress-health-evidence.json",
    "$PROFILE_ROOT/ingress-callback-evidence.json",
    "$PROFILE_ROOT/http-health.json",
    "$PROFILE_ROOT/http-readiness.json",
    "$PROFILE_ROOT/http-worker-heartbeats.json",
    ...capabilities
      .filter((id) => id !== "supabase-managed-postgres")
      .map((id) => `$PROFILE_ROOT/provider-capability-${id}.json`),
    ...Array.from(
      { length: input.workerReplicas },
      (_, index) => `$PROFILE_ROOT/process-worker-${index + 1}.json`,
    ),
  ];
}

function command(
  id: string,
  body: string,
  inputs: string[],
  outputs: string[],
  mustPass: string,
): RunbookCommand {
  return { id, command: body, cwd: "profile-root", inputs, outputs, mustPass };
}

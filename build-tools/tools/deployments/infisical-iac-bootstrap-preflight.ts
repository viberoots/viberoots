import * as path from "node:path";
import type { BootstrapArgs } from "./infisical-iac-bootstrap-types";

export function assertBootstrapPreflight(args: BootstrapArgs) {
  if (args.dryRun || args.yes) return;
  throw new Error(
    [
      "Infisical bootstrap requires --yes before mutation-capable execution.",
      "No Infisical resources, OpenTofu state, resolver config, or credential sink output was changed.",
      `Retry: ${bootstrapRetryCommand(args)}`,
      "Use --dry-run for read-only inspection.",
    ].join("\n"),
  );
}

export function bootstrapRetryCommand(args: BootstrapArgs) {
  return [
    "build-tools/tools/deployments/infisical-bootstrap.ts",
    args.mode,
    ...(args.mode === "deployment" ? retryFlag("target", args.target) : []),
    ...retryFlag("infisical-host", args.hostOverride ? args.apiUrl : ""),
    ...retryFlag("organization-id", args.organizationId),
    ...retryFlag("org-name", args.orgName),
    ...retryFlag("tofu-dir", args.tofuDir),
    ...retryFlag("tofu-plan-file", args.tofuPlanFile),
    ...retryFlag("credential-sink", args.credentialSink === "auto" ? "" : args.credentialSink),
    ...retryFlag("local-credential-file", args.localCredentialFile),
    "--yes",
  ].join(" ");
}

function retryFlag(name: string, value?: string) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return [];
  return [`--${name}`, quoteShell(trimmed)];
}

function quoteShell(value: string) {
  if (/^[A-Za-z0-9_./:=@%+-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function resolverConfigPath(dir = "sprinkleref") {
  return path.join(dir, "selected.local.json");
}

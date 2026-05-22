import os from "node:os";
import type { BootstrapArgs, Identity } from "./infisical-iac-bootstrap-types";

export function universalAuthSecretDescription(opts: {
  args: BootstrapArgs;
  identity: Identity;
  purpose: string;
  hostname?: string;
}) {
  return [
    "viberoots",
    opts.purpose,
    "Universal Auth",
    `identity=${opts.identity.name}`,
    `machine=${resolveMachineLabel(opts.args, opts.hostname)}`,
  ].join(" ");
}

export function resolveMachineLabel(args: BootstrapArgs, hostname = os.hostname()) {
  const label = (args.machineLabel || hostname || "unknown-machine").trim();
  return label || "unknown-machine";
}

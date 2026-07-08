import { spawnSync } from "node:child_process";
import os from "node:os";
import type { BootstrapArgs, Identity } from "./infisical-iac-bootstrap-types";

export function universalAuthSecretDescription(opts: {
  args: BootstrapArgs;
  identity: Identity;
  purpose: string;
  hostname?: string;
}) {
  if (opts.purpose === "repo-bootstrap") {
    return `${opts.args.bootstrapCredentialScope} bootstrap on ${resolveMachineLabel(opts.args, opts.hostname)}`;
  }
  return [
    "viberoots",
    opts.purpose,
    "Universal Auth",
    `identity=${opts.identity.name}`,
    `machine=${resolveMachineLabel(opts.args, opts.hostname)}`,
  ].join(" ");
}

export function resolveMachineLabel(
  args: BootstrapArgs,
  hostname = os.hostname(),
  systemLabel = resolveSystemMachineLabel(),
) {
  const label = (args.machineLabel || systemLabel || hostname || "unknown-machine").trim();
  return label || "unknown-machine";
}

export function resolveSystemMachineLabel(platform = process.platform) {
  if (platform === "darwin") {
    return firstCommandOutput([["scutil", "--get", "LocalHostName"]]);
  }
  if (platform === "linux") {
    return firstCommandOutput([
      ["hostname", "-s"],
      ["hostnamectl", "--static"],
    ]);
  }
  return undefined;
}

function firstCommandOutput(commands: string[][]) {
  for (const [command, ...args] of commands) {
    const output = commandOutput(command, args);
    if (output) return output;
  }
  return undefined;
}

function commandOutput(command: string, args: string[]) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    shell: false,
    stdio: ["ignore", "pipe", "ignore"],
    timeout: 1000,
  });
  if (result.status !== 0) return undefined;
  return result.stdout.trim() || undefined;
}

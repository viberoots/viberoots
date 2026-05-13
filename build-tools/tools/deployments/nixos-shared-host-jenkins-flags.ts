#!/usr/bin/env zx-wrapper
import { getFlagStr, hasFlag } from "../lib/cli";
import { JenkinsDeployError } from "./nixos-shared-host-jenkins-contract";

export function requireJenkinsFlagValue(name: string): string {
  const value = getFlagStr(name, "").trim();
  if (!value) throw new JenkinsDeployError("missing_required_flag", `missing required --${name}`);
  return value;
}

export function jenkinsSmokeOverrideArgs(): string[] {
  const host = getFlagStr("smoke-connect-host", "").trim();
  const port = getFlagStr("smoke-connect-port", "").trim();
  const protocol = getFlagStr("smoke-connect-protocol", "https:").trim();
  const anyOverride = host || port || hasFlag("smoke-connect-protocol");
  if (!anyOverride) return [];
  if (!host || !port) {
    throw new JenkinsDeployError(
      "invalid_smoke_override",
      "--smoke-connect-host and --smoke-connect-port are required together",
    );
  }
  return [
    "--smoke-connect-host",
    host,
    "--smoke-connect-port",
    port,
    "--smoke-connect-protocol",
    protocol === "http:" ? "http:" : "https:",
  ];
}

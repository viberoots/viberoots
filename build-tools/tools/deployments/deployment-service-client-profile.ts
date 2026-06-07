#!/usr/bin/env zx-wrapper
import path from "node:path";
import { getFlagStr, hasFlag } from "../lib/cli";
import { readNixosSharedHostClientProfile } from "./nixos-shared-host-install-dev-machine";
import {
  resolveServiceClientFromFlags,
  resolveServiceClientFromManifest,
  type NixosSharedHostResolvedServiceClient,
} from "./nixos-shared-host-service-client-config";

function resolveProfileRoot(workspaceRoot: string): string {
  const profileRoot = getFlagStr("profile-root", "").trim();
  return profileRoot
    ? path.resolve(profileRoot)
    : path.join(workspaceRoot, ".local", "deployments", "nixos-shared-host", "clients");
}

function requireProfileName(): string {
  const profileName = getFlagStr("profile", "").trim();
  if (!profileName) throw new Error("service-backed profile lookup requires --profile <name>");
  return profileName;
}

function hasServiceClientOverride(opts: {
  controlPlaneUrl?: string;
  controlPlaneToken?: string;
  remote?: string;
}): boolean {
  return Boolean(
    String(opts.controlPlaneUrl || "").trim() ||
      String(opts.controlPlaneToken || "").trim() ||
      String(opts.remote || "").trim() ||
      hasFlag("control-plane-url") ||
      hasFlag("control-plane-token") ||
      hasFlag("remote"),
  );
}

function assertNoProfileServiceClientFlagConflicts() {
  const conflicts = ["control-plane-url", "control-plane-token", "remote"].filter((flag) =>
    hasFlag(flag),
  );
  if (conflicts.length === 0) return;
  throw new Error(
    `--profile cannot be combined with service client flags: ${conflicts.map((flag) => `--${flag}`).join(", ")}`,
  );
}

export async function resolveServiceClientFromCliProfileOrFlags(opts: {
  workspaceRoot: string;
  controlPlaneUrl?: string;
  controlPlaneToken?: string;
  remote?: string;
  defaultProfileName?: string;
  context: string;
  env?: NodeJS.ProcessEnv;
}): Promise<NixosSharedHostResolvedServiceClient> {
  const remote = opts.remote ?? getFlagStr("remote", "").trim();
  const defaultProfileName = String(opts.defaultProfileName || "").trim();
  const shouldUseProfile =
    hasFlag("profile") ||
    hasFlag("profile-root") ||
    (defaultProfileName && !hasServiceClientOverride({ ...opts, remote }));
  if (shouldUseProfile) {
    assertNoProfileServiceClientFlagConflicts();
    const profileName = hasFlag("profile") ? requireProfileName() : defaultProfileName;
    if (!profileName) throw new Error("service-backed profile lookup requires --profile <name>");
    const profile = await readNixosSharedHostClientProfile({
      outputRoot: resolveProfileRoot(opts.workspaceRoot),
      profileName,
    });
    return resolveServiceClientFromManifest(profile.manifest, opts.env);
  }
  return resolveServiceClientFromFlags({
    controlPlaneUrl: opts.controlPlaneUrl,
    controlPlaneToken: opts.controlPlaneToken,
    remote,
    context: opts.context,
    env: opts.env,
  });
}

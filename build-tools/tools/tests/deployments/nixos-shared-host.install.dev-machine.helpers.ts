#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";

const INSTALL_SCRIPT = path.join(
  process.cwd(),
  "viberoots",
  "build-tools",
  "tools",
  "deployments",
  "nixos-shared-host-install.ts",
);

const DEFAULT_REMOTE_REPO_PATH = "/srv/viberoots";
const DEFAULT_REMOTE_STATE_PATH = "/etc/nixos/deployment-host/platform-state.json";
const DEFAULT_REMOTE_RUNTIME_ROOT = "/var/lib/deployment-host/runtime";
const DEFAULT_REMOTE_RECORDS_ROOT = "/var/lib/deployment-host/records";
const DEFAULT_CONTROL_PLANE_URL = "http://127.0.0.1:7780";
const DEFAULT_CONTROL_PLANE_TOKEN_ENV = "VBR_DEPLOY_CONTROL_PLANE_TOKEN";

export async function createSshAuthFixture(tmp: string) {
  const sshIdentityFile = path.join(tmp, "id_ed25519");
  const sshKnownHostsFile = path.join(tmp, "known_hosts");
  await fsp.writeFile(sshIdentityFile, "key\n", "utf8");
  await fsp.writeFile(sshKnownHostsFile, "mini ssh-ed25519 AAAA\n", "utf8");
  return { sshIdentityFile, sshKnownHostsFile };
}

export function defaultInstallArgs(profile: string): string[] {
  return [
    "--profile",
    profile,
    "--destination",
    profile,
    "--remote-repo-path",
    DEFAULT_REMOTE_REPO_PATH,
    "--remote-state-path",
    DEFAULT_REMOTE_STATE_PATH,
    "--remote-runtime-root",
    DEFAULT_REMOTE_RUNTIME_ROOT,
    "--remote-records-root",
    DEFAULT_REMOTE_RECORDS_ROOT,
    "--ssh-mode",
    "ssh",
    "--control-plane-url",
    DEFAULT_CONTROL_PLANE_URL,
  ];
}

export async function runClientInstall(
  $: any,
  outputRoot: string,
  args: string[],
  opts: { input?: string; nothrow?: boolean } = {},
) {
  const runner = typeof opts.input === "string" ? $({ input: opts.input }) : $;
  const command = runner`zx-wrapper ${INSTALL_SCRIPT} client install --output-root ${outputRoot} ${args}`;
  return opts.nothrow ? await command.nothrow() : await command;
}

export async function runClientList($: any, outputRoot: string) {
  return await $`zx-wrapper ${INSTALL_SCRIPT} client list --output-root ${outputRoot}`;
}

export async function runClientUninstall(
  $: any,
  outputRoot: string,
  args: string[],
  opts: { nothrow?: boolean } = {},
) {
  const command = $`zx-wrapper ${INSTALL_SCRIPT} client uninstall --output-root ${outputRoot} ${args}`;
  return opts.nothrow ? await command.nothrow() : await command;
}

export async function assertDefaultManifest(
  summary: any,
  opts: {
    profileName: string;
    sshIdentityFile?: string;
    sshKnownHostsFile?: string;
    hasSshAuth?: boolean;
    controlPlaneUrl?: string;
  },
) {
  const {
    profileName,
    sshIdentityFile,
    sshKnownHostsFile,
    hasSshAuth = true,
    controlPlaneUrl = DEFAULT_CONTROL_PLANE_URL,
  } = opts;
  assert.equal(summary.manifest.profileName, profileName);
  assert.equal(summary.manifest.destination, profileName);
  assert.equal(summary.manifest.remoteRepoPath, DEFAULT_REMOTE_REPO_PATH);
  assert.equal(summary.manifest.remoteStatePath, DEFAULT_REMOTE_STATE_PATH);
  assert.equal(summary.manifest.remoteRuntimeRoot, DEFAULT_REMOTE_RUNTIME_ROOT);
  assert.equal(summary.manifest.remoteRecordsRoot, DEFAULT_REMOTE_RECORDS_ROOT);
  assert.equal(summary.manifest.sshMode, "ssh");
  assert.equal(summary.manifest.serviceClient.controlPlaneUrl, controlPlaneUrl);
  assert.equal(
    summary.manifest.serviceClient.controlPlaneTokenEnv,
    DEFAULT_CONTROL_PLANE_TOKEN_ENV,
  );
  if (hasSshAuth) {
    assert.equal(summary.manifest.sshAuth.identityFile, sshIdentityFile);
    assert.equal(summary.manifest.sshAuth.knownHostsFile, sshKnownHostsFile);
  } else {
    assert.equal("sshAuth" in summary.manifest, false);
  }
}

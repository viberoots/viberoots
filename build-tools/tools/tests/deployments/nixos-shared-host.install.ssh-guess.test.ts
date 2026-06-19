#!/usr/bin/env zx-wrapper
import { viberootsToolScript } from "./deployment-command";
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

async function ensureSshDir(home: string): Promise<string> {
  const sshDir = path.join(home, ".ssh");
  await fsp.mkdir(sshDir, { recursive: true });
  return sshDir;
}

test("nixos-shared-host client install infers SSH auth from matching ~/.ssh/config entries", async () => {
  await runInTemp("nixos-shared-host-client-install-ssh-config", async (tmp, $) => {
    const home = path.join(tmp, "home");
    const outputRoot = path.join(tmp, "profiles");
    const sshDir = await ensureSshDir(home);
    const identityFile = path.join(sshDir, "mini-deploy");
    const knownHostsFile = path.join(sshDir, "mini-known-hosts");
    await fsp.writeFile(identityFile, "key\n", "utf8");
    await fsp.writeFile(knownHostsFile, "mini ssh-ed25519 AAAA\n", "utf8");
    await fsp.writeFile(
      path.join(sshDir, "config"),
      [
        "Host *",
        "  UserKnownHostsFile ~/.ssh/mini-known-hosts",
        "",
        "Host mini",
        "  IdentityFile ~/.ssh/mini-deploy",
        "",
      ].join("\n"),
      "utf8",
    );
    const result = await $({
      env: { ...process.env, HOME: home },
    })`zx-wrapper ${viberootsToolScript("build-tools/tools/deployments/nixos-shared-host-install.ts")} client install --output-root ${outputRoot} --profile mini --destination deployer@mini --control-plane-url http://127.0.0.1:7780`;
    const summary = JSON.parse(String(result.stdout));
    assert.equal(summary.manifest.sshAuth.identityFile, identityFile);
    assert.equal(summary.manifest.sshAuth.knownHostsFile, knownHostsFile);
  });
});

test("nixos-shared-host client install infers SSH auth from a single standard key and known_hosts file", async () => {
  await runInTemp("nixos-shared-host-client-install-ssh-standard", async (tmp, $) => {
    const home = path.join(tmp, "home");
    const outputRoot = path.join(tmp, "profiles");
    const sshDir = await ensureSshDir(home);
    const identityFile = path.join(sshDir, "id_ed25519");
    const knownHostsFile = path.join(sshDir, "known_hosts");
    await fsp.writeFile(identityFile, "key\n", "utf8");
    await fsp.writeFile(knownHostsFile, "mini ssh-ed25519 AAAA\n", "utf8");
    const result = await $({
      env: { ...process.env, HOME: home },
    })`zx-wrapper ${viberootsToolScript("build-tools/tools/deployments/nixos-shared-host-install.ts")} client install --output-root ${outputRoot} --profile mini --destination mini --control-plane-url http://127.0.0.1:7780`;
    const summary = JSON.parse(String(result.stdout));
    assert.equal(summary.manifest.sshAuth.identityFile, identityFile);
    assert.equal(summary.manifest.sshAuth.knownHostsFile, knownHostsFile);
  });
});

test("nixos-shared-host client install fails closed when multiple standard SSH identities exist", async () => {
  await runInTemp("nixos-shared-host-client-install-ssh-ambiguous", async (tmp, $) => {
    const home = path.join(tmp, "home");
    const outputRoot = path.join(tmp, "profiles");
    const sshDir = await ensureSshDir(home);
    await fsp.writeFile(path.join(sshDir, "id_ed25519"), "key\n", "utf8");
    await fsp.writeFile(path.join(sshDir, "id_rsa"), "key\n", "utf8");
    await fsp.writeFile(path.join(sshDir, "known_hosts"), "mini ssh-ed25519 AAAA\n", "utf8");
    const result = await $({
      env: { ...process.env, HOME: home },
    })`zx-wrapper ${viberootsToolScript("build-tools/tools/deployments/nixos-shared-host-install.ts")} client install --output-root ${outputRoot} --profile mini --destination mini --control-plane-url http://127.0.0.1:7780`.nothrow();
    assert.notEqual(result.exitCode, 0);
    assert.match(String(result.stderr), /multiple plausible SSH identity files/i);
  });
});

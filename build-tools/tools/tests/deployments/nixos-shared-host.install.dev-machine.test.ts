#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInScratchTemp } from "../lib/test-helpers";
import {
  assertDefaultManifest,
  createSshAuthFixture,
  defaultInstallArgs,
  runClientInstall,
  runClientList,
  runClientUninstall,
} from "./nixos-shared-host.install.dev-machine.helpers";

test("nixos-shared-host client install accepts required parameters by flags", async () => {
  await runInScratchTemp("nixos-shared-host-client-flags", async (tmp, $) => {
    const outputRoot = path.join(tmp, "profiles");
    const { sshIdentityFile, sshKnownHostsFile } = await createSshAuthFixture(tmp);
    const result = await runClientInstall($, outputRoot, [
      "--profile",
      "mini",
      "--ssh-identity-file",
      sshIdentityFile,
      "--ssh-known-hosts",
      sshKnownHostsFile,
      "--control-plane-url",
      "http://127.0.0.1:7780",
    ]);
    const summary = JSON.parse(String(result.stdout));
    await assertDefaultManifest(summary, {
      profileName: "mini",
      sshIdentityFile,
      sshKnownHostsFile,
    });
    await fsp.access(path.join(outputRoot, "mini.json"));
  });
});

test("nixos-shared-host client install accepts required parameters by stdin and applies declarative defaults when stdin is partial", async () => {
  await runInScratchTemp("nixos-shared-host-client-stdin", async (tmp, $) => {
    const outputRoot = path.join(tmp, "profiles");
    const { sshIdentityFile, sshKnownHostsFile } = await createSshAuthFixture(tmp);
    const payload = JSON.stringify({
      profileName: "mini",
      destination: "mini",
      remoteRepoPath: "/srv/common",
      remoteStatePath: "/etc/nixos/deployment-host/platform-state.json",
      remoteRuntimeRoot: "/var/lib/deployment-host/runtime",
      remoteRecordsRoot: "/var/lib/deployment-host/records",
      sshMode: "ssh",
      sshIdentityFile,
      sshKnownHostsFile,
      controlPlaneUrl: "http://127.0.0.1:7780",
    });
    const ok = await runClientInstall($, outputRoot, [], { input: payload });
    assert.equal(JSON.parse(String(ok.stdout)).manifest.destination, "mini");
    const partial = await runClientInstall($, outputRoot, [], {
      input: '{"profileName":"mini"}',
      nothrow: true,
    });
    assert.equal(partial.exitCode, 0);
    const partialSummary = JSON.parse(String(partial.stdout));
    await assertDefaultManifest(partialSummary, { profileName: "mini", hasSshAuth: false });
  });
});

test("nixos-shared-host client install ignores empty stdin", async () => {
  await runInScratchTemp("nixos-shared-host-client-empty-stdin", async (tmp, $) => {
    const outputRoot = path.join(tmp, "profiles");
    const { sshIdentityFile, sshKnownHostsFile } = await createSshAuthFixture(tmp);
    const result = await runClientInstall(
      $,
      outputRoot,
      [
        "--profile",
        "mini",
        "--ssh-identity-file",
        sshIdentityFile,
        "--ssh-known-hosts",
        sshKnownHostsFile,
        "--control-plane-url",
        "http://127.0.0.1:7780",
      ],
      { input: "" },
    );
    const summary = JSON.parse(String(result.stdout));
    await assertDefaultManifest(summary, {
      profileName: "mini",
      sshIdentityFile,
      sshKnownHostsFile,
    });
    await fsp.access(path.join(outputRoot, "mini.json"));
  });
});

test("nixos-shared-host client list reports installed profiles", async () => {
  await runInScratchTemp("nixos-shared-host-client-list", async (tmp, $) => {
    const outputRoot = path.join(tmp, "profiles");
    await runClientInstall($, outputRoot, defaultInstallArgs("mini"));
    await runClientInstall($, outputRoot, defaultInstallArgs("staging"));
    const result = await runClientList($, outputRoot);
    const summary = JSON.parse(String(result.stdout));
    assert.deepEqual(
      summary.profiles.map(
        (entry: { manifest: { profileName: string } }) => entry.manifest.profileName,
      ),
      ["mini", "staging"],
    );
  });
});

test("nixos-shared-host client list reports malformed profiles without blocking valid ones", async () => {
  await runInScratchTemp("nixos-shared-host-client-list-invalid", async (tmp, $) => {
    const outputRoot = path.join(tmp, "profiles");
    await fsp.mkdir(outputRoot, { recursive: true });
    await fsp.writeFile(
      path.join(outputRoot, "default.json"),
      JSON.stringify(
        {
          schemaVersion: "nixos-shared-host-client@1",
          tool: "nixos-shared-host-install",
          toolFingerprint: "old",
          profileName: "default",
          destination: "default",
          remoteRepoPath: "/srv/common",
          remoteStatePath: "/var/lib/viberoots/nixos-shared-host/platform-state.json",
          remoteRuntimeRoot: "/var/lib/viberoots/nixos-shared-host/runtime",
          remoteRecordsRoot: "/var/lib/viberoots/nixos-shared-host/records",
          sshMode: "ssh",
          localManagedPaths: [path.join(outputRoot, "default.json")],
        },
        null,
        2,
      ),
    );
    await runClientInstall($, outputRoot, [
      "--profile",
      "mini",
      "--control-plane-url",
      "http://127.0.0.1:7780",
    ]);
    const result = await runClientList($, outputRoot);
    const summary = JSON.parse(String(result.stdout));
    assert.deepEqual(
      summary.profiles.map(
        (entry: { manifest: { profileName: string } }) => entry.manifest.profileName,
      ),
      ["mini"],
    );
    assert.deepEqual(
      summary.invalidProfiles.map((entry: { profileName: string }) => entry.profileName),
      ["default"],
    );
  });
});

test("nixos-shared-host client uninstall removes exactly one profile when --profile is provided", async () => {
  await runInScratchTemp("nixos-shared-host-client-uninstall-profile", async (tmp, $) => {
    const outputRoot = path.join(tmp, "profiles");
    await runClientInstall($, outputRoot, defaultInstallArgs("mini"));
    await runClientInstall($, outputRoot, defaultInstallArgs("staging"));
    const uninstall = await runClientUninstall($, outputRoot, ["--profile", "mini"]);
    const summary = JSON.parse(String(uninstall.stdout));
    assert.deepEqual(summary.removedProfiles, ["mini"]);
    await assert.rejects(() => fsp.access(path.join(outputRoot, "mini.json")));
    await fsp.access(path.join(outputRoot, "staging.json"));
  });
});

test("nixos-shared-host client uninstall removes malformed profiles by name", async () => {
  await runInScratchTemp("nixos-shared-host-client-uninstall-invalid", async (tmp, $) => {
    const outputRoot = path.join(tmp, "profiles");
    await fsp.mkdir(outputRoot, { recursive: true });
    const staleProfile = path.join(outputRoot, "default.json");
    await fsp.writeFile(staleProfile, '{"profileName":"default"}');
    const uninstall = await runClientUninstall($, outputRoot, ["--profile", "default"]);
    const summary = JSON.parse(String(uninstall.stdout));
    assert.deepEqual(summary.removedProfiles, ["default"]);
    assert.deepEqual(summary.removedPaths, [staleProfile]);
    assert.deepEqual(
      summary.invalidProfiles.map((entry: { profileName: string }) => entry.profileName),
      ["default"],
    );
    await assert.rejects(() => fsp.access(staleProfile));
  });
});

test("nixos-shared-host client uninstall fails for a missing profile", async () => {
  await runInScratchTemp("nixos-shared-host-client-uninstall-missing-profile", async (tmp, $) => {
    const outputRoot = path.join(tmp, "profiles");
    const result = await runClientUninstall($, outputRoot, ["--profile", "missing"], {
      nothrow: true,
    });
    assert.notEqual(result.exitCode, 0);
    assert.match(String(result.stderr), /ENOENT|no such file/i);
  });
});

test("nixos-shared-host client uninstall removes all profiles when --all is provided", async () => {
  await runInScratchTemp("nixos-shared-host-client-uninstall-all", async (tmp, $) => {
    const outputRoot = path.join(tmp, "profiles");
    await runClientInstall($, outputRoot, defaultInstallArgs("mini"));
    await runClientInstall($, outputRoot, defaultInstallArgs("staging"));
    const uninstall = await runClientUninstall($, outputRoot, ["--all"]);
    const summary = JSON.parse(String(uninstall.stdout));
    assert.deepEqual(summary.removedProfiles, ["mini", "staging"]);
    const list = await runClientList($, outputRoot);
    assert.deepEqual(JSON.parse(String(list.stdout)).profiles, []);
  });
});

test("nixos-shared-host client uninstall fails closed without --profile or --all", async () => {
  await runInScratchTemp("nixos-shared-host-client-uninstall-missing-selector", async (tmp, $) => {
    const outputRoot = path.join(tmp, "profiles");
    const result = await runClientUninstall($, outputRoot, [], { nothrow: true });
    assert.notEqual(result.exitCode, 0);
    assert.match(String(result.stderr), /requires --profile <name> or --all/);
  });
});

test("nixos-shared-host client uninstall fails closed when --profile and --all are combined", async () => {
  await runInScratchTemp(
    "nixos-shared-host-client-uninstall-conflicting-selectors",
    async (tmp, $) => {
      const outputRoot = path.join(tmp, "profiles");
      const result = await runClientUninstall($, outputRoot, ["--profile", "mini", "--all"], {
        nothrow: true,
      });
      assert.notEqual(result.exitCode, 0);
      assert.match(String(result.stderr), /either --profile or --all, not both/);
    },
  );
});

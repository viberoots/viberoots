#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  maybePromptClientInstallInput,
  maybePromptServerInstallInput,
} from "../../deployments/nixos-shared-host-install-prompt";

test("nixos-shared-host prompt helper uses inline rules for server install", async () => {
  const calls: Array<{ input: Record<string, unknown>; rules: Record<string, unknown> }> = [];
  const result = await maybePromptServerInstallInput(
    {},
    {
      interactive: true,
      runner: async (input, rules) => {
        calls.push({ input, rules });
        return {
          serverRoot: null,
          configRoot: "/etc/nixos",
          installMode: "managed-manual-wire",
          configEntryPath: "/etc/nixos/configuration.nix",
          managedRoot: null,
          statePath: "/var/lib/custom/state.json",
          runtimeRoot: null,
          recordsRoot: null,
          configTopology: null,
        };
      },
    },
  );
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0]?.rules.required, ["configRoot", "installMode"]);
  assert.deepEqual(calls[0]?.rules.defaults, {
    serverRoot: "/",
    configRoot: "/etc/nixos",
    installMode: "managed-manual-wire",
  });
  assert.deepEqual(calls[0]?.rules.requiredWhen, []);
  assert.deepEqual(calls[0]?.rules.defaultTemplates, {});
  assert.equal(result.configEntryPath, "/etc/nixos/configuration.nix");
  assert.equal(result.statePath, "/var/lib/custom/state.json");
});

test("nixos-shared-host prompt helper uses inline rules for client install", async () => {
  let capturedRules: Record<string, unknown> | undefined;
  let capturedInput: Record<string, unknown> | undefined;
  const result = await maybePromptClientInstallInput(
    "/workspace",
    {},
    {
      interactive: true,
      runner: async (input, rules) => {
        capturedInput = input;
        capturedRules = rules;
        return {
          profileName: "mini",
          destination: "mini",
          remoteRepoPath: "/srv/common",
          remoteStatePath: "/etc/nixos/deployment-host/platform-state.json",
          remoteRuntimeRoot: "/var/lib/deployment-host/runtime",
          remoteRecordsRoot: "/var/lib/deployment-host/records",
          sshMode: "ssh",
          sshIdentityFile: "/Users/me/.ssh/mini",
          sshKnownHostsFile: "/Users/me/.ssh/known_hosts-mini",
          controlPlaneUrl: "http://127.0.0.1:7780",
          controlPlaneTokenEnv: "BNX_DEPLOY_CONTROL_PLANE_TOKEN",
        };
      },
    },
  );
  assert.deepEqual(capturedRules?.required, [
    "profileName",
    "remoteRepoPath",
    "remoteStatePath",
    "remoteRuntimeRoot",
    "remoteRecordsRoot",
    "sshMode",
    "controlPlaneUrl",
  ]);
  assert.deepEqual(capturedRules?.defaults, {
    profileName: "default",
    remoteRepoPath: "/srv/common",
    remoteStatePath: "/etc/nixos/deployment-host/platform-state.json",
    remoteRuntimeRoot: "/var/lib/deployment-host/runtime",
    remoteRecordsRoot: "/var/lib/deployment-host/records",
    sshMode: "ssh",
    controlPlaneUrl: "http://127.0.0.1:7780",
    controlPlaneTokenEnv: "BNX_DEPLOY_CONTROL_PLANE_TOKEN",
  });
  assert.deepEqual(capturedRules?.defaultTemplates, {
    destination: "${profileName}",
  });
  assert.deepEqual(capturedInput, {});
  assert.equal(result.remoteRepoPath, "/srv/common");
  assert.equal(result.sshIdentityFile, "/Users/me/.ssh/mini");
  assert.equal(result.sshKnownHostsFile, "/Users/me/.ssh/known_hosts-mini");
  assert.equal(result.controlPlaneUrl, "http://127.0.0.1:7780");
});

test("nixos-shared-host prompt helper applies declarative defaults without prompting when not interactive", async () => {
  const input = {};
  const result = await maybePromptServerInstallInput(input, { interactive: false });
  assert.deepEqual(result, {
    serverRoot: "/",
    configRoot: "/etc/nixos",
    installMode: "managed-manual-wire",
  });
});

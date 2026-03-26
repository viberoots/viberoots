#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  maybePromptDevMachineInstallInput,
  maybePromptHostInstallInput,
} from "../../deployments/nixos-shared-host-install-prompt.ts";

test("nixos-shared-host prompt helper uses inline rules for host install", async () => {
  const calls: Array<{ input: Record<string, unknown>; rules: Record<string, unknown> }> = [];
  const result = await maybePromptHostInstallInput(
    {},
    {
      interactive: true,
      runner: async (input, rules) => {
        calls.push({ input, rules });
        return {
          hostRoot: null,
          configRoot: "/etc/nixos",
          installMode: "managed-dropin",
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
    configRoot: "/etc/nixos",
    installMode: "managed-dropin",
  });
  assert.deepEqual(calls[0]?.rules.requiredWhen, [
    {
      if: { installMode: "managed-dropin" },
      require: ["configEntryPath"],
    },
  ]);
  assert.deepEqual(calls[0]?.rules.defaultTemplates, {
    configEntryPath: "${configRoot}/configuration.nix",
  });
  assert.equal(result.configEntryPath, "/etc/nixos/configuration.nix");
  assert.equal(result.statePath, "/var/lib/custom/state.json");
});

test("nixos-shared-host prompt helper uses inline rules for dev-machine install", async () => {
  let capturedRules: Record<string, unknown> | undefined;
  let capturedInput: Record<string, unknown> | undefined;
  const result = await maybePromptDevMachineInstallInput(
    "/Users/kiltyj/Code/bucknix-fresh",
    {},
    {
      interactive: true,
      runner: async (input, rules) => {
        capturedInput = input;
        capturedRules = rules;
        return {
          profileName: "mini",
          destination: "mini",
          remoteRepoPath: "/srv/bucknix-fresh",
          remoteStatePath: "/var/lib/bucknix/nixos-shared-host/platform-state.json",
          remoteRuntimeRoot: "/var/lib/bucknix/nixos-shared-host/runtime",
          remoteRecordsRoot: "/var/lib/bucknix/nixos-shared-host/records",
          sshMode: "ssh",
        };
      },
    },
  );
  assert.deepEqual(capturedRules?.required, [
    "profileName",
    "destination",
    "remoteRepoPath",
    "remoteStatePath",
    "remoteRuntimeRoot",
    "remoteRecordsRoot",
    "sshMode",
  ]);
  assert.deepEqual(capturedRules?.defaults, {
    profileName: "default",
    remoteRepoPath: "/srv/bucknix-fresh",
    remoteStatePath: "/var/lib/bucknix/nixos-shared-host/platform-state.json",
    remoteRuntimeRoot: "/var/lib/bucknix/nixos-shared-host/runtime",
    remoteRecordsRoot: "/var/lib/bucknix/nixos-shared-host/records",
    sshMode: "ssh",
  });
  assert.deepEqual(capturedRules?.defaultTemplates, {
    destination: "${profileName}",
  });
  assert.deepEqual(capturedInput, {});
  assert.equal(result.remoteRepoPath, "/srv/bucknix-fresh");
});

test("nixos-shared-host prompt helper applies declarative defaults without prompting when not interactive", async () => {
  const input = { configRoot: "/etc/nixos", installMode: "emit-only" as const };
  const result = await maybePromptHostInstallInput(input, { interactive: false });
  assert.deepEqual(result, {
    ...input,
    configEntryPath: "/etc/nixos/configuration.nix",
  });
});

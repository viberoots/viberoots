#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  resetLocalUsage,
  runInfisicalBootstrapResetLocal,
} from "../../deployments/infisical-bootstrap-reset-local";

test("local reset dry-run prints consequences without deleting state", async () => {
  const output: string[] = [];
  const removed: string[] = [];
  await runInfisicalBootstrapResetLocal(["--dry-run"], {
    stdout: (line) => output.push(line),
    stderr: () => assert.fail("dry-run should not warn on stderr"),
    removePath: async (target) => {
      removed.push(target);
    },
    keychainRunner: () => {
      assert.fail("dry-run should not touch Keychain");
    },
  });
  const text = output.join("\n");
  assert.match(text, /WARNING: this deletes local Infisical bootstrap state/);
  assert.match(text, /sprinkleref/);
  assert.match(text, /terraform\.tfstate/);
  assert.match(text, /secret:\/\/viberoots\/bootstrap\/viberoots-iac-bootstrap\/client-secret/);
  assert.match(text, /does not delete Infisical cloud resources/);
  assert.deepEqual(removed, []);
});

test("local reset requires explicit RESET confirmation", async () => {
  await assert.rejects(
    () =>
      runInfisicalBootstrapResetLocal([], {
        stdout: () => undefined,
        question: async () => "yes",
        removePath: async () => assert.fail("cancelled reset must not remove files"),
        keychainRunner: () => {
          assert.fail("cancelled reset must not touch Keychain");
        },
      }),
    /reset cancelled/,
  );
});

test("local reset removes generated paths and keychain entries after confirmation", async () => {
  const removed: string[] = [];
  const keychain: string[][] = [];
  await runInfisicalBootstrapResetLocal([], {
    cwd: "/repo",
    platform: "darwin",
    stdout: () => undefined,
    question: async () => "RESET",
    removePath: async (target) => {
      removed.push(target);
    },
    keychainRunner: (command, args) => {
      keychain.push([command, ...args]);
      return { status: 0 };
    },
  });
  assert.deepEqual(removed, [
    "/repo/sprinkleref",
    "/repo/projects/deployments/pleomino/infisical/opentofu/.terraform",
    "/repo/projects/deployments/pleomino/infisical/opentofu/.terraform.lock.hcl",
    "/repo/projects/deployments/pleomino/infisical/opentofu/terraform.tfstate",
    "/repo/projects/deployments/pleomino/infisical/opentofu/terraform.tfstate.backup",
  ]);
  assert.equal(keychain.length, 6);
  assert.equal(keychain[0][0], "security");
  assert.deepEqual(keychain[0].slice(1, 4), [
    "delete-generic-password",
    "-s",
    "viberoots-bootstrap",
  ]);
});

test("local reset supports noninteractive --yes", async () => {
  let prompted = false;
  await runInfisicalBootstrapResetLocal(["--yes"], {
    stdout: () => undefined,
    question: async () => {
      prompted = true;
      return "no";
    },
    removePath: async () => undefined,
    platform: "linux",
    stderr: () => undefined,
  });
  assert.equal(prompted, false);
});

test("local reset usage documents the operator command", () => {
  assert.match(resetLocalUsage(), /infisical-bootstrap-reset-local\.ts --dry-run/);
  assert.match(resetLocalUsage(), /--yes/);
});

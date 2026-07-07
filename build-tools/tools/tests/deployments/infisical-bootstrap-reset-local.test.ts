#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
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
  assert.match(text, /\.local\/infisical-bootstrap-credentials\.json/);
  assert.match(text, /secret:\/\/bootstrap\/common\/viberoots-iac-bootstrap\/client-secret/);
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
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), "infisical-reset-local-"));
  const tofuDir = path.join(repo, "projects/deployments/example/infisical/opentofu");
  await fs.mkdir(path.join(tofuDir, ".terraform"), { recursive: true });
  await fs.writeFile(path.join(tofuDir, ".terraform.lock.hcl"), "");
  await fs.writeFile(path.join(tofuDir, "terraform.tfstate"), "{}");
  await fs.writeFile(path.join(tofuDir, "terraform.tfstate.backup"), "{}");
  const removed: string[] = [];
  const keychain: string[][] = [];
  await runInfisicalBootstrapResetLocal([], {
    cwd: repo,
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
    path.join(repo, "sprinkleref"),
    path.join(repo, ".local/infisical-bootstrap-credentials.json"),
    path.join(repo, "projects/deployments/example/infisical/opentofu/.terraform"),
    path.join(repo, "projects/deployments/example/infisical/opentofu/.terraform.lock.hcl"),
    path.join(repo, "projects/deployments/example/infisical/opentofu/terraform.tfstate"),
    path.join(repo, "projects/deployments/example/infisical/opentofu/terraform.tfstate.backup"),
  ]);
  assert.equal(keychain.length, 2);
  assert.equal(keychain[0][0], "security");
  assert.deepEqual(keychain[0].slice(1, 4), [
    "delete-generic-password",
    "-s",
    "viberoots-bootstrap",
  ]);
  assert.ok(
    keychain.some((entry) =>
      entry.includes(`secret://bootstrap/${path.basename(repo)}/viberoots-iac-bootstrap/client-id`),
    ),
  );
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

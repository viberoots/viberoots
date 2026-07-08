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
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), "infisical-reset-local-"));
  await fs.mkdir(path.join(repo, ".local"), { recursive: true });
  await fs.writeFile(path.join(repo, ".local/infisical-bootstrap-credentials.json"), "{}");
  const output: string[] = [];
  const removed: string[] = [];
  await runInfisicalBootstrapResetLocal(["--dry-run"], {
    cwd: repo,
    platform: "darwin",
    stdout: (line) => output.push(line),
    stderr: () => assert.fail("dry-run should not warn on stderr"),
    removePath: async (target) => {
      removed.push(target);
    },
    keychainRunner: (_command, args) => {
      return {
        status: args.includes(
          `secret://bootstrap/${path.basename(repo)}/viberoots-iac-bootstrap/infisical/universal-auth/client-secret`,
        )
          ? 0
          : 44,
      };
    },
  });
  const text = output.join("\n");
  assert.match(text, /Mode: DRY RUN/);
  assert.match(
    text,
    /\.local\/infisical-bootstrap-credentials\.json - local-file bootstrap credential store/,
  );
  assert.doesNotMatch(text, /sprinkleref/);
  assert.match(
    text,
    new RegExp(
      `secret://bootstrap/${path.basename(repo)}/viberoots-iac-bootstrap/infisical/universal-auth/client-secret - Infisical Universal Auth client secret`,
    ),
  );
  assert.doesNotMatch(
    text,
    new RegExp("viberoots-iac-bootstrap/infisical/universal-auth/client-id"),
  );
  assert.match(text, /Infisical cloud resources, Cloudflare secrets, and application secrets/);
  assert.deepEqual(removed, []);
  await fs.rm(repo, { recursive: true, force: true });
});

test("local reset requires explicit RESET confirmation", async () => {
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), "infisical-reset-confirm-"));
  await fs.mkdir(path.join(repo, "sprinkleref"), { recursive: true });
  await assert.rejects(
    () =>
      runInfisicalBootstrapResetLocal([], {
        cwd: repo,
        stdout: () => undefined,
        question: async () => "yes",
        removePath: async () => assert.fail("cancelled reset must not remove files"),
        keychainRunner: (_command, args) => {
          if (args[0] === "delete-generic-password") {
            assert.fail("cancelled reset must not delete Keychain entries");
          }
          return { status: 44 };
        },
      }),
    /reset cancelled/,
  );
  await fs.rm(repo, { recursive: true, force: true });
});

test("local reset removes generated paths and keychain entries after confirmation", async () => {
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), "infisical-reset-local-"));
  await fs.mkdir(path.join(repo, "sprinkleref"), { recursive: true });
  await fs.mkdir(path.join(repo, ".local"), { recursive: true });
  await fs.writeFile(path.join(repo, ".local/infisical-bootstrap-credentials.json"), "{}");
  const tofuDir = path.join(repo, "projects/deployments/example/infisical/opentofu");
  await fs.mkdir(path.join(tofuDir, ".terraform"), { recursive: true });
  await fs.writeFile(path.join(tofuDir, ".terraform.lock.hcl"), "");
  await fs.writeFile(path.join(tofuDir, "terraform.tfstate"), "{}");
  await fs.writeFile(path.join(tofuDir, "terraform.tfstate.backup"), "{}");
  const removed: string[] = [];
  const keychainDeletes: string[][] = [];
  await runInfisicalBootstrapResetLocal([], {
    cwd: repo,
    platform: "darwin",
    stdout: () => undefined,
    question: async () => "RESET",
    removePath: async (target) => {
      removed.push(target);
    },
    keychainRunner: (command, args) => {
      if (args[0] === "delete-generic-password") keychainDeletes.push([command, ...args]);
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
  assert.equal(keychainDeletes.length, 2);
  assert.equal(keychainDeletes[0][0], "security");
  assert.deepEqual(keychainDeletes[0].slice(1, 4), [
    "delete-generic-password",
    "-s",
    `${path.basename(repo)}-bootstrap`,
  ]);
  assert.ok(
    keychainDeletes.some((entry) =>
      entry.includes(
        `secret://bootstrap/${path.basename(repo)}/viberoots-iac-bootstrap/infisical/universal-auth/client-id`,
      ),
    ),
  );
  await fs.rm(repo, { recursive: true, force: true });
});

test("local reset supports noninteractive --yes", async () => {
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), "infisical-reset-yes-"));
  let prompted = false;
  await runInfisicalBootstrapResetLocal(["--yes"], {
    cwd: repo,
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
  await fs.rm(repo, { recursive: true, force: true });
});

test("local reset does not prompt when no local state exists", async () => {
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), "infisical-reset-empty-"));
  let prompted = false;
  const output: string[] = [];
  await runInfisicalBootstrapResetLocal([], {
    cwd: repo,
    platform: "darwin",
    stdout: (line) => output.push(line),
    question: async () => {
      prompted = true;
      return "RESET";
    },
    removePath: async () => assert.fail("empty reset must not remove files"),
    keychainRunner: () => ({ status: 44 }),
  });
  assert.equal(prompted, false);
  assert.match(output.join("\n"), /No existing local bootstrap files or Keychain entries/);
  await fs.rm(repo, { recursive: true, force: true });
});

test("local reset usage documents the operator command", () => {
  assert.match(resetLocalUsage(), /infisical-bootstrap-reset-local\.ts --dry-run/);
  assert.match(resetLocalUsage(), /--yes/);
});

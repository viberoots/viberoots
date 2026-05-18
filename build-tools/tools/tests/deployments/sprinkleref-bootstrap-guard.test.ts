#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { runSprinkleRefCli } from "../../deployments/sprinkleref-cli";
import { readSprinkleRefConfig } from "../../deployments/sprinkleref-config";

test("resolver entry edits reject Infisical bootstrap category", async () => {
  const configPath = await writeConfig(await tmp());
  await assert.rejects(
    () =>
      runSprinkleRefCli({
        argv: [
          ...entryArgs(configPath, "add"),
          "--backend",
          "infisical",
          "--host",
          "https://app.infisical.com",
          "--project-id",
          "proj_123",
          "--default-environment",
          "prod",
          "--client-id-env",
          "INFISICAL_CLIENT_ID",
          "--client-secret-env",
          "INFISICAL_CLIENT_SECRET",
        ],
        stdout: () => undefined,
      }),
    /bootstrap category must not use an Infisical backend/,
  );
});

test("resolver entry edits allow non-Infisical bootstrap category", async () => {
  const configPath = await writeConfig(await tmp());
  await runSprinkleRefCli({
    argv: [
      ...entryArgs(configPath, "add"),
      "--backend",
      "jenkins",
      "--scope",
      "folder",
      "--name-prefix",
      "VBR_",
    ],
    stdout: () => undefined,
  });
  assert.equal((await readSprinkleRefConfig(configPath)).categories.bootstrap.backend, "jenkins");
});

function entryArgs(configPath: string, mode: "add" | "update") {
  return ["--config", configPath, "--resolver-entry", `--${mode}`, "bootstrap"];
}

async function writeConfig(dir: string) {
  const configPath = path.join(dir, "resolver.json");
  await fs.writeFile(
    configPath,
    `${JSON.stringify({
      version: 1,
      defaultCategory: "main",
      categories: { main: { backend: "local-file", file: "main.json" } },
    })}\n`,
  );
  return configPath;
}

async function tmp() {
  return await fs.mkdtemp(path.join(os.tmpdir(), "sprinkleref-bootstrap-guard-"));
}

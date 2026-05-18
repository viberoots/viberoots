#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { runSprinkleRefCli } from "../../deployments/sprinkleref-cli";
import { readSprinkleRefConfig } from "../../deployments/sprinkleref-config";
import { initSprinkleRefConfigs } from "../../deployments/sprinkleref-templates";

test("resolver entry add preserves unrelated config text", async () => {
  const dir = await tmp();
  const configPath = await writeCommentedConfig(dir);
  await runSprinkleRefCli({
    argv: entryArgs(configPath, "add", ["--backend", "local-file", "--file", "bootstrap.json"]),
    stdout: () => undefined,
  });
  const added = await fs.readFile(configPath, "utf8");
  assert.match(added, /keep operator note/);
  assert.match(added, /"main"[\s\S]*"bootstrap"/);
  const config = await readSprinkleRefConfig(configPath);
  assert.equal(config.categories.bootstrap.file, "bootstrap.json");
});

test("resolver entry add overwrites only with explicit mode", async () => {
  const dir = await tmp();
  const configPath = await writeCommentedConfig(dir);
  await runSprinkleRefCli({
    argv: entryArgs(configPath, "add", ["--backend", "local-file", "--file", "one.json"]),
    stdout: () => undefined,
  });
  await assert.rejects(
    () =>
      runSprinkleRefCli({
        argv: entryArgs(configPath, "add", ["--backend", "local-file", "--file", "two.json"]),
        stdout: () => undefined,
      }),
    /already exists/,
  );
  await runSprinkleRefCli({
    argv: entryArgs(configPath, "add", [
      "--overwrite-existing",
      "--backend",
      "local-file",
      "--file",
      "two.json",
    ]),
    stdout: () => undefined,
  });
  assert.equal((await readSprinkleRefConfig(configPath)).categories.bootstrap.file, "two.json");
});

test("resolver entry overwrite preserves following entries and comments", async () => {
  const dir = await tmp();
  const configPath = await writeMultiBackendConfig(dir);
  await runSprinkleRefCli({
    argv: entryArgs(configPath, "add", [
      "--overwrite-existing",
      "--backend",
      "local-file",
      "--file",
      "rotated-bootstrap.json",
    ]),
    stdout: () => undefined,
  });
  const text = await fs.readFile(configPath, "utf8");
  assert.match(text, /keep ci backend/);
  const config = await readSprinkleRefConfig(configPath);
  assert.equal(config.categories.bootstrap.file, "rotated-bootstrap.json");
  assert.equal(config.categories.ci.backend, "github-actions");
});

test("resolver entry update creates missing entries only with explicit mode", async () => {
  const dir = await tmp();
  const configPath = await writeConfig(dir);
  const argv = entryArgs(configPath, "update", [
    "--backend",
    "local-file",
    "--file",
    "bootstrap.json",
  ]);
  await assert.rejects(() => runSprinkleRefCli({ argv, stdout: () => undefined }), /is missing/);
  await runSprinkleRefCli({ argv: [...argv, "--create-missing"], stdout: () => undefined });
  assert.equal(
    (await readSprinkleRefConfig(configPath)).categories.bootstrap.file,
    "bootstrap.json",
  );
});

test("resolver entry update preserves inherited base config", async () => {
  const dir = await tmp();
  const configPath = await writeExtendingConfig(dir);
  await runSprinkleRefCli({
    argv: entryArgs(
      configPath,
      "update",
      ["--backend", "local-file", "--file", "rotated-main.json"],
      "main",
    ),
    stdout: () => undefined,
  });
  const text = await fs.readFile(configPath, "utf8");
  assert.match(text, /"bootstrap"/);
  const config = await readSprinkleRefConfig(configPath);
  assert.equal(config.categories.main.file, "rotated-main.json");
  assert.equal(config.categories.bootstrap.service, "viberoots-bootstrap");
});

test("resolver entry update accepts generated profile-backed resolver config", async () => {
  const dir = await tmp();
  await initSprinkleRefConfigs({ dir, platform: "darwin" });
  const configPath = path.join(dir, "selected.local.json");
  await runSprinkleRefCli({
    argv: entryArgs(configPath, "update", [
      "--backend",
      "local-file",
      "--file",
      "rotated-bootstrap.json",
    ]),
    stdout: () => undefined,
  });
  const config = await readSprinkleRefConfig(configPath);
  assert.equal(config.categories.bootstrap.file, "rotated-bootstrap.json");
  assert.deepEqual(config.categories.main, { profile: "infisical-default" });
  assert.equal(config.profiles["infisical-default"]?.backend, "infisical");
});

test("resolver entry edits reject secret value inputs", async () => {
  const dir = await tmp();
  const configPath = await writeConfig(dir);
  await assert.rejects(
    () =>
      runSprinkleRefCli({
        argv: [
          ...entryArgs(configPath, "add", ["--backend", "local-file", "--file", "bootstrap.json"]),
          "--value-env",
          "SECRET",
        ],
        env: { SECRET: "not-written" },
        stdout: () => undefined,
      }),
    /secret values are not accepted/,
  );
  assert.doesNotMatch(await fs.readFile(configPath, "utf8"), /not-written/);
});

function entryArgs(
  configPath: string,
  mode: "add" | "update",
  rest: string[],
  category = "bootstrap",
) {
  return ["--config", configPath, "--resolver-entry", `--${mode}`, category, ...rest];
}

async function writeCommentedConfig(dir: string) {
  const configPath = path.join(dir, "resolver.jsonc");
  await fs.writeFile(
    configPath,
    `{
  // keep operator note
  "version": 1,
  "defaultCategory": "main",
  "categories": {
    "main": {
      "backend": "local-file",
      "file": "main.json"
    }
  }
}
`,
  );
  return configPath;
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

async function writeMultiBackendConfig(dir: string) {
  const configPath = path.join(dir, "multi-resolver.jsonc");
  await fs.writeFile(
    configPath,
    `{
  // keep top-level note
  "version": 1,
  "defaultCategory": "main",
  "categories": {
    "main": {
      "backend": "local-file",
      "file": "main.json"
    },
    "bootstrap": {
      "backend": "local-file",
      "file": "bootstrap.json"
    },
    // keep ci backend
    "ci": {
      "backend": "github-actions",
      "scope": "repository",
      "namePrefix": "VIBEROOTS_"
    }
  }
}
`,
  );
  return configPath;
}

async function writeExtendingConfig(dir: string) {
  await fs.writeFile(
    path.join(dir, "base.json"),
    `${JSON.stringify({
      version: 1,
      defaultCategory: "main",
      categories: { main: { backend: "local-file", file: "main.json" } },
    })}\n`,
  );
  const configPath = path.join(dir, "selected.local.json");
  await fs.writeFile(
    configPath,
    `${JSON.stringify({
      version: 1,
      extends: "./base.json",
      defaultCategory: "main",
      categories: {
        bootstrap: { backend: "macos-keychain", service: "viberoots-bootstrap" },
      },
    })}\n`,
  );
  return configPath;
}

async function tmp() {
  return await fs.mkdtemp(path.join(os.tmpdir(), "sprinkleref-config-edit-"));
}

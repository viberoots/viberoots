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
  const argv = entryArgs(configPath, "update", localFileArgs("bootstrap.json"));
  await assert.rejects(() => runSprinkleRefCli({ argv, stdout: () => undefined }), /is missing/);
  await runSprinkleRefCli({ argv: [...argv, "--create-missing"], stdout: () => undefined });
  assert.equal(
    (await readSprinkleRefConfig(configPath)).categories.bootstrap.file,
    "bootstrap.json",
  );
});

test("resolver entry update accepts generated profile-backed resolver config", async () => {
  const dir = await tmp();
  await initSprinkleRefConfigs({ dir, platform: "darwin" });
  const generated = JSON.parse(await fs.readFile(path.join(dir, "shared.json"), "utf8"));
  const configPath = path.join(dir, "operator-config.json");
  await fs.writeFile(
    configPath,
    `${JSON.stringify({ environments: generated.environments, ...generated.sprinkleref }, null, 2)}\n`,
  );
  await runSprinkleRefCli({
    argv: entryArgs(configPath, "update", localFileArgs("rotated-control.json"), "control"),
    stdout: () => undefined,
  });
  const config = await readSprinkleRefConfig(configPath);
  assert.equal(config.categories.control.file, "rotated-control.json");
  assert.deepEqual(config.categories.main, {
    profile: "infisical-default",
    environment: "staging",
  });
  assert.equal(config.profiles["infisical-default"]?.backend, "infisical");
});

test("resolver entry edits reject secret value inputs", async () => {
  const dir = await tmp();
  const configPath = await writeConfig(dir);
  await assert.rejects(
    () =>
      runSprinkleRefCli({
        argv: [
          ...entryArgs(configPath, "add", localFileArgs("bootstrap.json")),
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

function localFileArgs(file: string) {
  return ["--backend", "local-file", "--file", file];
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

async function tmp() {
  return await fs.mkdtemp(path.join(os.tmpdir(), "sprinkleref-config-edit-"));
}

#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { runSprinkleRefCli } from "../../deployments/sprinkleref-cli";

test("sprinkleref add update remove preserve by default for local-file backend", async () => {
  const dir = await tmp();
  const config = await localConfig(dir);
  const ref = "secret://deployments/pleomino/staging/cloudflare-api-token";
  await run(["--config", config, "--add", ref, "--value-env", "TOKEN"], { TOKEN: "one" });
  await assert.rejects(
    () => run(["--config", config, "--add", ref, "--value-env", "TOKEN"], { TOKEN: "two" }),
    /already exists/,
  );
  await run(["--config", config, "--update", ref, "--value-file", await valueFile(dir, "two")]);
  assert.equal((await readStore(dir))[ref], "two");
  await assert.rejects(
    () => run(["--config", config, "--remove", ref], {}),
    /requires confirmation/,
  );
  await run(["--config", config, "--remove", ref, "--yes"], {});
  assert.deepEqual(await readStore(dir), {});
});

test("sprinkleref prompt fallback and dry-run do not read secret values", async () => {
  const dir = await tmp();
  const config = await localConfig(dir);
  const ref = "secret://deployments/pleomino/prod/cloudflare-api-token";
  const output: string[] = [];
  await runSprinkleRefCli({
    argv: ["--config", config, "--add", ref, "--dry-run"],
    prompt: async () => {
      throw new Error("prompt should not run");
    },
    stdout: (text) => output.push(text),
  });
  assert.match(output.join("\n"), /local-file/);
  await runSprinkleRefCli({
    argv: ["--config", config, "--add", ref],
    prompt: async () => "hidden-secret",
    stdout: () => undefined,
  });
  assert.equal((await readStore(dir))[ref], "hidden-secret");
});

test("sprinkleref add fails non-interactively when value input is missing", async () => {
  const dir = await tmp();
  const config = await localConfig(dir);
  await assert.rejects(
    () =>
      runSprinkleRefCli({
        argv: ["--config", config, "--add", "secret://deployments/pleomino/staging/missing-input"],
        stdout: () => undefined,
      }),
    /missing secret value.*--value-env.*--value-file.*TTY/,
  );
});

async function run(argv: string[], env: NodeJS.ProcessEnv) {
  await runSprinkleRefCli({ argv, env, stdout: () => undefined });
}

async function localConfig(dir: string) {
  const config = path.join(dir, "config.json");
  await fs.writeFile(
    config,
    JSON.stringify({
      version: 1,
      defaultCategory: "main",
      categories: { main: { backend: "local-file", file: path.join(dir, "secrets.json") } },
    }),
  );
  return config;
}

async function readStore(dir: string) {
  return JSON.parse(await fs.readFile(path.join(dir, "secrets.json"), "utf8")) as Record<
    string,
    string
  >;
}

async function valueFile(dir: string, value: string) {
  const file = path.join(dir, "value.txt");
  await fs.writeFile(file, value);
  return file;
}

async function tmp() {
  return await fs.mkdtemp(path.join(os.tmpdir(), "sprinkleref-command-"));
}

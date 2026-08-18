#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { execFile as execFileCb } from "node:child_process";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";

const execFileAsync = promisify(execFileCb);

async function readRepoFile(rel: string): Promise<string> {
  return await fsp.readFile(viberootsSourcePath(rel), "utf8");
}

test("devshell path initialization promotes nested viberoots checkout to parent workspace", async () => {
  const source = await readRepoFile("build-tools/tools/bin/devshell.sh");
  const start = source.indexOf("env_init_paths() {");
  const end = source.indexOf('\n. "${ENV_SH_DIR}/devshell-cache-config.sh"', start);
  const fn = source.slice(start, end);
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-devshell-parent-live-root-"));
  try {
    const consumer = path.join(root, "consumer");
    const nested = path.join(consumer, "viberoots");
    const nestedBin = path.join(nested, "build-tools/tools/bin");
    const fakeBin = path.join(root, "fake-bin");
    await Promise.all([
      fsp.mkdir(nestedBin, { recursive: true }),
      fsp.mkdir(path.join(nested, "build-tools/tools/dev"), { recursive: true }),
      fsp.mkdir(path.join(consumer, ".viberoots/workspace"), { recursive: true }),
      fsp.mkdir(fakeBin, { recursive: true }),
    ]);
    await fsp.writeFile(path.join(nested, "build-tools/tools/dev/zx-init.mjs"), "");
    await fsp.writeFile(path.join(consumer, ".viberoots/workspace/flake.nix"), "{}\n");
    await fsp.writeFile(
      path.join(fakeBin, "git"),
      `#!/usr/bin/env bash\nprintf '%s\\n' ${JSON.stringify(nested)}\n`,
      { mode: 0o755 },
    );
    const { stdout } = await execFileAsync(
      "/bin/bash",
      [
        "-c",
        `${fn}\nexport PATH="$1:/usr/bin:/bin"; unset WORKSPACE_ROOT VIBEROOTS_SOURCE_ROOT VIBEROOTS_ROOT; cd "$2"; env_init_paths "$3"; printf 'LIVE_ROOT=%s\\nVIBEROOTS_ROOT=%s\\n' "$LIVE_ROOT" "$VIBEROOTS_ROOT"`,
        "devshell-init-paths-test",
        fakeBin,
        nested,
        path.join(nestedBin, "b"),
      ],
      { env: process.env },
    );
    assert.match(stdout, new RegExp(`LIVE_ROOT=${escapeRegExp(consumer)}`));
    assert.match(stdout, new RegExp(`VIBEROOTS_ROOT=${escapeRegExp(nested)}`));
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("devshell stale detection rejects divergent local and filtered source identities", async () => {
  const fn = await staleDetectionFunction();
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-devshell-source-identity-"));
  try {
    const localFile = path.join(root, "viberoots", "build-tools", "lang", "nix_shell.bzl");
    const marker = path.join(
      root,
      ".viberoots/workspace/viberoots-flake-input/.source-fingerprint",
    );
    await fsp.mkdir(path.dirname(localFile), { recursive: true });
    await fsp.mkdir(path.dirname(marker), { recursive: true });
    await fsp.writeFile(localFile, "identity-a\n");
    await fsp.writeFile(marker, "");
    await fsp.utimes(localFile, new Date(Date.now() - 10_000), new Date(Date.now() - 10_000));
    await fsp.utimes(marker, new Date(), new Date());
    await assertRejectsExit(fn, root, 1);
    await fsp.writeFile(localFile, "identity-b\n");
    await fsp.utimes(localFile, new Date(Date.now() + 10_000), new Date(Date.now() + 10_000));
    await assertRejectsExit(fn, root, 0);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("devshell stale detection rejects divergent generated and active artifact authority", async () => {
  const fn = await staleDetectionFunction();
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-devshell-tool-authority-"));
  try {
    const manifest = path.join(root, ".viberoots/workspace/toolchain-paths.json");
    await fsp.mkdir(path.dirname(manifest), { recursive: true });
    await fsp.writeFile(
      manifest,
      `${JSON.stringify({ artifactTools: { root: "/nix/store/generated-tools" } }, null, 2)}\n`,
    );
    await assertRejectsExit(fn, root, 1, {
      VBR_DEVSHELL_ARTIFACT_TOOLS_ROOT: "/nix/store/generated-tools",
    });
    await assertRejectsExit(fn, root, 0, {
      VBR_DEVSHELL_ARTIFACT_TOOLS_ROOT: "/nix/store/stale-tools",
    });
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

async function staleDetectionFunction(): Promise<string> {
  const source = await readRepoFile("build-tools/tools/bin/devshell-workspace.sh");
  const start = source.indexOf("devshell_inputs_stale() {");
  const end = source.indexOf("\ndevshell_stale_reload_allowed() {", start);
  return source.slice(start, end);
}

async function assertRejectsExit(
  fn: string,
  root: string,
  expected: number,
  env: NodeJS.ProcessEnv = {},
): Promise<void> {
  const result = await execFileAsync(
    "/bin/bash",
    ["-c", `${fn}\ndevshell_inputs_stale "$1"`, "devshell-stale-test", root],
    { env: { ...process.env, ...env } },
  ).then(
    () => 0,
    (error: NodeJS.ErrnoException) => Number(error.code),
  );
  assert.equal(result, expected);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

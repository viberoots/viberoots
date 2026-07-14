#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { ensureBuckConfigForTempRepo } from "./test-helpers/buck-config";

test("temp repo buck config propagates shared pnpm hash cache root into actions", async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "buck-config-shared-pnpm-cache-"));
  const durableRoot = path.join(tmp, "durable-cache-root");
  const prevSharedRoot = process.env.VBR_SHARED_PNPM_STORE_HASH_CACHE_ROOT;
  const prevSharedPrelude = process.env.VBR_SHARED_PRELUDE_PATH;
  process.env.VBR_SHARED_PNPM_STORE_HASH_CACHE_ROOT = durableRoot;
  process.env.VBR_SHARED_PRELUDE_PATH = path.join(process.cwd(), "viberoots", "prelude");
  try {
    await ensureBuckConfigForTempRepo(tmp, $);
    const buckConfig = await fsp.readFile(path.join(tmp, ".buckconfig"), "utf8");
    assert.match(
      buckConfig,
      /\baction_env = .*VBR_SHARED_PNPM_STORE_HASH_CACHE_ROOT\b/,
      "nested Buck actions must receive the durable shared pnpm hash cache root",
    );
    const workspaceRootEnv = await fsp.readFile(
      path.join(tmp, ".viberoots", "workspace", "buck", "workspace-root.env"),
      "utf8",
    );
    assert.match(
      workspaceRootEnv,
      new RegExp(
        `^VBR_SHARED_PNPM_STORE_HASH_CACHE_ROOT=${durableRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
        "m",
      ),
      "workspace-root.env must preserve the durable shared pnpm hash cache root",
    );
  } finally {
    if (prevSharedRoot === undefined) delete process.env.VBR_SHARED_PNPM_STORE_HASH_CACHE_ROOT;
    else process.env.VBR_SHARED_PNPM_STORE_HASH_CACHE_ROOT = prevSharedRoot;
    if (prevSharedPrelude === undefined) delete process.env.VBR_SHARED_PRELUDE_PATH;
    else process.env.VBR_SHARED_PRELUDE_PATH = prevSharedPrelude;
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("temp repo buck config uses selected flake input for nix prelude resolution", async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "buck-config-flake-input-root-"));
  const binDir = path.join(tmp, "bin");
  const selectedInputRoot = path.join(tmp, "selected-viberoots");
  const fakePreludeOut = path.join(tmp, "fake-prelude-out");
  const nixArgLog = path.join(tmp, "nix-args.log");
  const oldSourceRoot = process.env.VIBEROOTS_SOURCE_ROOT;
  const oldRoot = process.env.VIBEROOTS_ROOT;
  const oldInputRoot = process.env.VIBEROOTS_FLAKE_INPUT_ROOT;
  const oldSharedPrelude = process.env.VBR_SHARED_PRELUDE_PATH;
  try {
    await fsp.mkdir(binDir, { recursive: true });
    await fsp.mkdir(selectedInputRoot, { recursive: true });
    await fsp.mkdir(path.join(fakePreludeOut, "prelude"), { recursive: true });
    await fsp.writeFile(path.join(fakePreludeOut, "prelude", "prelude.bzl"), "# prelude\n", "utf8");
    await fsp.writeFile(
      path.join(selectedInputRoot, "flake.nix"),
      "{ outputs = _: {}; }\n",
      "utf8",
    );
    await fsp.writeFile(
      path.join(binDir, "nix"),
      [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        `printf '%s\\n' "$*" >> ${JSON.stringify(nixArgLog)}`,
        'case "$1" in',
        "  build)",
        `    printf '%s\\n' ${JSON.stringify(fakePreludeOut)}`,
        "    ;;",
        "  eval)",
        `    printf '%s\\n' ${JSON.stringify(fakePreludeOut)}`,
        "    ;;",
        "esac",
      ].join("\n"),
      "utf8",
    );
    await fsp.chmod(path.join(binDir, "nix"), 0o755);
    process.env.VIBEROOTS_SOURCE_ROOT = "/nix/viberoots";
    process.env.VIBEROOTS_ROOT = "/nix/viberoots";
    delete process.env.VIBEROOTS_FLAKE_INPUT_ROOT;
    delete process.env.VBR_SHARED_PRELUDE_PATH;

    const fake$ = $({
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH || ""}`,
      },
      stdio: "pipe",
    });
    await ensureBuckConfigForTempRepo(tmp, fake$, {
      viberootsInputRoot: selectedInputRoot,
      viberootsSourceRoot: "/nix/viberoots",
    });

    const nixArgs = await fsp.readFile(nixArgLog, "utf8");
    assert.match(
      nixArgs,
      new RegExp(`path:${selectedInputRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
    );
    assert.doesNotMatch(nixArgs, /--override-input/);
    assert.doesNotMatch(nixArgs, new RegExp(`path:${tmp.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}#`));
    assert.doesNotMatch(nixArgs, /path:\/nix\/viberoots/);
  } finally {
    if (oldSourceRoot === undefined) delete process.env.VIBEROOTS_SOURCE_ROOT;
    else process.env.VIBEROOTS_SOURCE_ROOT = oldSourceRoot;
    if (oldRoot === undefined) delete process.env.VIBEROOTS_ROOT;
    else process.env.VIBEROOTS_ROOT = oldRoot;
    if (oldInputRoot === undefined) delete process.env.VIBEROOTS_FLAKE_INPUT_ROOT;
    else process.env.VIBEROOTS_FLAKE_INPUT_ROOT = oldInputRoot;
    if (oldSharedPrelude === undefined) delete process.env.VBR_SHARED_PRELUDE_PATH;
    else process.env.VBR_SHARED_PRELUDE_PATH = oldSharedPrelude;
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("temp repo buck config uses seeded local prelude before nix fallback", async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "buck-config-local-prelude-"));
  const binDir = path.join(tmp, "bin");
  const oldSharedPrelude = process.env.VBR_SHARED_PRELUDE_PATH;
  try {
    await fsp.mkdir(path.join(tmp, "viberoots", "prelude"), { recursive: true });
    await fsp.writeFile(
      path.join(tmp, "viberoots", "prelude", "prelude.bzl"),
      "# prelude\n",
      "utf8",
    );
    await fsp.mkdir(binDir, { recursive: true });
    await fsp.writeFile(
      path.join(binDir, "nix"),
      ["#!/usr/bin/env bash", "echo unexpected nix fallback >&2", "exit 99"].join("\n"),
      "utf8",
    );
    await fsp.chmod(path.join(binDir, "nix"), 0o755);
    delete process.env.VBR_SHARED_PRELUDE_PATH;

    const fake$ = $({
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH || ""}`,
      },
      stdio: "pipe",
    });
    await ensureBuckConfigForTempRepo(tmp, fake$);

    const linkedPrelude = await fsp
      .readlink(path.join(tmp, "viberoots", "prelude"))
      .catch(() => "");
    assert.equal(
      linkedPrelude,
      "",
      "existing seeded local prelude should be kept without invoking nix fallback",
    );
  } finally {
    if (oldSharedPrelude === undefined) delete process.env.VBR_SHARED_PRELUDE_PATH;
    else process.env.VBR_SHARED_PRELUDE_PATH = oldSharedPrelude;
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

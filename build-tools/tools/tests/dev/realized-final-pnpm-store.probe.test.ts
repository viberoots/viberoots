import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { materializeFilteredViberootsSource } from "../../dev/filtered-flake-viberoots-input";
import {
  inspectFinalPnpmStore,
  probeRealizedFinalPnpmStore,
  realizedFinalStoreProbeTimeoutMs,
} from "../../dev/update-pnpm-hash/realized-store";

type FakeMode =
  | "eval-failure"
  | "missing"
  | "invalid"
  | "validity-command-failure"
  | "validity-malformed"
  | "validation-failure"
  | "success";

let immutableAuthorityPromise: Promise<string> | undefined;

async function immutableAuthority(): Promise<string> {
  immutableAuthorityPromise ||= (async () => {
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-final-probe-authority-"));
    try {
      await fsp.mkdir(path.join(tmp, "build-tools/tools/dev"), { recursive: true });
      await fsp.writeFile(path.join(tmp, "flake.nix"), "{ outputs = _: {}; }\n");
      await fsp.writeFile(path.join(tmp, "build-tools/tools/dev/zx-init.mjs"), "\n");
      return (await materializeFilteredViberootsSource(tmp)).storePath;
    } finally {
      await fsp.rm(tmp, { recursive: true, force: true });
    }
  })();
  return await immutableAuthorityPromise;
}

function existingStorePath(): string {
  const match = path.resolve(process.execPath).match(/^(\/nix\/store\/[^/]+)/);
  if (!match?.[1]) throw new Error(`test node is not in /nix/store: ${process.execPath}`);
  return match[1];
}

async function withFakeNix<T>(
  mode: FakeMode,
  evaluatedPath: string,
  fn: (log: string) => Promise<T>,
) {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-final-probe-"));
  const log = path.join(tmp, "nix.log");
  const nix = path.join(tmp, "nix");
  const nixStore = path.join(tmp, "nix-store");
  const authority = await immutableAuthority();
  await fsp.writeFile(
    nix,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      `printf 'args=%s exact=%s index=%s lock=%s generate=%s materialize=%s\\n' "$*" "\${NIX_PNPM_EXACT_STORE:-}" "\${NIX_PNPM_EXACT_STORE_INDEX:-}" "\${NIX_PNPM_EXACT_STORE_LOCK_HASH:-}" "\${NIX_PNPM_ALLOW_GENERATE:-}" "\${NIX_PNPM_MATERIALIZE:-}" >> ${JSON.stringify(log)}`,
      `if [[ "$1" == "eval" ]]; then`,
      mode === "eval-failure"
        ? '  echo "authoritative eval failure" >&2; exit 41'
        : `  printf '%s' ${JSON.stringify(evaluatedPath)}; exit 0`,
      "fi",
      mode === "validation-failure"
        ? 'echo "literal path validation failure" >&2; exit 42'
        : 'printf "%s\\n" "$2"',
    ].join("\n"),
    { mode: 0o755 },
  );
  await fsp.writeFile(
    nixStore,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      `printf 'store-args=%s\\n' "$*" >> ${JSON.stringify(log)}`,
      mode === "validity-command-failure"
        ? 'echo "literal validity command failure" >&2; exit 43'
        : mode === "validity-malformed"
          ? 'printf "%s\\n" "/nix/store/unexpected-invalid-path"'
          : mode === "invalid"
            ? 'printf "%s\\n" "$3"'
            : ":",
    ].join("\n"),
    { mode: 0o755 },
  );
  const previous = {
    nix: process.env.VBR_NIX_BIN,
    nixStore: process.env.VBR_NIX_STORE_BIN,
    exact: process.env.NIX_PNPM_EXACT_STORE,
    index: process.env.NIX_PNPM_EXACT_STORE_INDEX,
    lock: process.env.NIX_PNPM_EXACT_STORE_LOCK_HASH,
    generate: process.env.NIX_PNPM_ALLOW_GENERATE,
    materialize: process.env.NIX_PNPM_MATERIALIZE,
    authority: process.env.VIBEROOTS_FLAKE_INPUT_ROOT,
  };
  try {
    process.env.VBR_NIX_BIN = nix;
    process.env.VBR_NIX_STORE_BIN = nixStore;
    process.env.NIX_PNPM_EXACT_STORE = "forbidden-exact";
    process.env.NIX_PNPM_EXACT_STORE_INDEX = "forbidden-index";
    process.env.NIX_PNPM_EXACT_STORE_LOCK_HASH = "forbidden-lock";
    process.env.NIX_PNPM_ALLOW_GENERATE = "1";
    process.env.NIX_PNPM_MATERIALIZE = "1";
    process.env.VIBEROOTS_FLAKE_INPUT_ROOT = authority;
    return await fn(log);
  } finally {
    for (const [key, value] of Object.entries({
      VBR_NIX_BIN: previous.nix,
      VBR_NIX_STORE_BIN: previous.nixStore,
      NIX_PNPM_EXACT_STORE: previous.exact,
      NIX_PNPM_EXACT_STORE_INDEX: previous.index,
      NIX_PNPM_EXACT_STORE_LOCK_HASH: previous.lock,
      NIX_PNPM_ALLOW_GENERATE: previous.generate,
      NIX_PNPM_MATERIALIZE: previous.materialize,
      VIBEROOTS_FLAKE_INPUT_ROOT: previous.authority,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await fsp.rm(tmp, { recursive: true, force: true });
  }
}

function probe(expectedPath: string) {
  return probeRealizedFinalPnpmStore({
    repoRoot: process.cwd(),
    importer: "projects/apps/demo",
    flakeRef: "path:/tmp/filtered#pnpm",
    attrPath: "pnpm-store.projects-apps-demo",
    expectedPath,
  });
}

test("final store probes inherit the bounded pnpm Nix timeout", () => {
  assert.equal(realizedFinalStoreProbeTimeoutMs({ NIX_PNPM_FETCH_TIMEOUT: "1800" }), 1_800_000);
  assert.equal(realizedFinalStoreProbeTimeoutMs({ NIX_PNPM_FETCH_TIMEOUT: "5" }), 30_000);
  assert.equal(realizedFinalStoreProbeTimeoutMs({}), 600_000);
});

test("probe propagates authoritative Nix evaluation failure", async () => {
  await withFakeNix("eval-failure", "/nix/store/unused", async () => {
    await assert.rejects(probe("/nix/store/unused"), /authoritative eval failure/);
  });
});

test("probe maps only a physically absent evaluated FOD to a repair diagnostic", async () => {
  const missing = `/nix/store/${"0".repeat(32)}-missing-final-pnpm-store`;
  await withFakeNix("missing", missing, async (log) => {
    await assert.rejects(
      probe(missing),
      /final pnpm store is not realized[\s\S]*no tracked files were modified/,
    );
    assert.doesNotMatch(await fsp.readFile(log, "utf8"), /args=path-info/);
  });
});

test("rebuild inspection reports physical absence without hiding eval failures", async () => {
  const missing = `/nix/store/${"0".repeat(32)}-missing-final-pnpm-store`;
  await withFakeNix("missing", missing, async () => {
    assert.deepEqual(
      await inspectFinalPnpmStore({
        repoRoot: process.cwd(),
        importer: "projects/apps/demo",
        flakeRef: "path:/tmp/filtered#pnpm",
        attrPath: "pnpm-store.projects-apps-demo",
        expectedPath: missing,
      }),
      { status: "absent", path: missing },
    );
  });
  await withFakeNix("eval-failure", missing, async () => {
    await assert.rejects(
      inspectFinalPnpmStore({
        repoRoot: process.cwd(),
        importer: "projects/apps/demo",
        flakeRef: "path:/tmp/filtered#pnpm",
        attrPath: "pnpm-store.projects-apps-demo",
        expectedPath: missing,
      }),
      /authoritative eval failure/,
    );
  });
});

test("probe propagates literal path validation failure", async () => {
  const present = existingStorePath();
  await withFakeNix("validation-failure", present, async () => {
    await assert.rejects(probe(present), (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      return (
        message.includes("literal path validation failure") &&
        !message.includes("no tracked files were modified")
      );
    });
  });
});

test("rebuild inspection reports a physically present invalid path", async () => {
  const present = existingStorePath();
  await withFakeNix("invalid", present, async (log) => {
    assert.deepEqual(
      await inspectFinalPnpmStore({
        repoRoot: process.cwd(),
        importer: "projects/apps/demo",
        flakeRef: "path:/tmp/filtered#pnpm",
        attrPath: "pnpm-store.projects-apps-demo",
        expectedPath: present,
      }),
      { status: "invalid", path: present },
    );
    const commands = await fsp.readFile(log, "utf8");
    assert.match(commands, /store-args=--check-validity --print-invalid \/nix\/store\//);
    assert.doesNotMatch(commands, /args=path-info/);
  });
});

test("ordinary probe maps a physically present invalid path to repair", async () => {
  const present = existingStorePath();
  await withFakeNix("invalid", present, async () => {
    await assert.rejects(probe(present), /final pnpm store is not realized[\s\S]*repair: run u/);
  });
});

for (const [mode, expected] of [
  ["validity-command-failure", /literal validity command failure/],
  ["validity-malformed", /validity check returned unexpected output/],
] as const) {
  test(`probe propagates ${mode}`, async () => {
    const present = existingStorePath();
    await withFakeNix(mode, present, async () => {
      await assert.rejects(probe(present), (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        return expected.test(message) && !message.includes("no tracked files were modified");
      });
    });
  });
}

test("probe validates the literal evaluated path with a sanitized environment", async () => {
  const present = existingStorePath();
  await withFakeNix("success", present, async (log) => {
    assert.equal(await probe(present), present);
    const commands = await fsp.readFile(log, "utf8");
    assert.match(
      commands,
      /args=eval --override-input viberoots path:[^ ]+ --raw --no-write-lock-file --accept-flake-config path:\/tmp\/filtered#pnpm-store\.projects-apps-demo\.outPath/,
    );
    assert.match(
      commands,
      new RegExp(
        `store-args=--check-validity --print-invalid ${present.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
      ),
    );
    assert.match(
      commands,
      new RegExp(`args=path-info ${present.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
    );
    assert.doesNotMatch(commands, /forbidden-(?:exact|index|lock)|generate=1|materialize=1/);
  });
});

test("filtered consumer probe uses only its marked bounded snapshot root", async () => {
  const present = existingStorePath();
  await withFakeNix("success", present, async (log) => {
    const previous = {
      workspace: process.env.WORKSPACE_ROOT,
      filtered: process.env.VBR_PNPM_FILTERED_SNAPSHOT_ROOT,
    };
    try {
      process.env.WORKSPACE_ROOT = "/tmp/filtered";
      process.env.VBR_PNPM_FILTERED_SNAPSHOT_ROOT = "/tmp/filtered";
      assert.equal(await probe(present), present);
      assert.match(
        await fsp.readFile(log, "utf8"),
        /args=eval --impure --override-input viberoots path:[^ ]+ --raw .*path:\/tmp\/filtered#pnpm-store/,
      );
    } finally {
      if (previous.workspace === undefined) delete process.env.WORKSPACE_ROOT;
      else process.env.WORKSPACE_ROOT = previous.workspace;
      if (previous.filtered === undefined) delete process.env.VBR_PNPM_FILTERED_SNAPSHOT_ROOT;
      else process.env.VBR_PNPM_FILTERED_SNAPSHOT_ROOT = previous.filtered;
    }
  });
});

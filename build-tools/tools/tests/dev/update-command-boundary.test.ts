#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { repairGoDependencies, repairPythonDependencies } from "../../dev/update-command/languages";
import { runUpdateCommand, type UpdateOperations } from "../../dev/update-command/run";

test("language repair creates conservative Go and Python lock metadata", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-update-languages-"));
  const goDir = path.join(root, "projects/apps/go-app");
  const pythonDir = path.join(root, "projects/apps/python-app");
  const fakeGo = path.join(root, "fake-go.sh");
  const priorRoot = process.env.WORKSPACE_ROOT;
  try {
    await fsp.mkdir(goDir, { recursive: true });
    await fsp.mkdir(pythonDir, { recursive: true });
    await fsp.writeFile(path.join(goDir, "go.mod"), "module example.test/go-app\n");
    await fsp.writeFile(
      path.join(pythonDir, "pyproject.toml"),
      "[project]\nname='python-app'\nversion='0.1.0'\n",
    );
    await fsp.writeFile(
      fakeGo,
      `#!/usr/bin/env bash
set -euo pipefail
if [[ "$*" == "mod tidy -diff" ]]; then
  printf '%s\n' 'diff --git a/go.sum b/go.sum'
  exit 1
fi
: > go.sum
`,
    );
    await fsp.chmod(fakeGo, 0o755);
    process.env.WORKSPACE_ROOT = root;

    await repairGoDependencies(root, false, false, fakeGo);
    await repairPythonDependencies(root, false);

    assert.equal(await fsp.readFile(path.join(goDir, "go.sum"), "utf8"), "");
    assert.match(
      await fsp.readFile(path.join(goDir, "gomod2nix.toml"), "utf8"),
      /^# viberoots-go-input-sha256: [a-f0-9]{64}\nschema = 3\n\n\[mod\]\n$/,
    );
    assert.match(await fsp.readFile(path.join(pythonDir, "uv.lock"), "utf8"), /^version = 1$/m);
  } finally {
    if (priorRoot === undefined) delete process.env.WORKSPACE_ROOT;
    else process.env.WORKSPACE_ROOT = priorRoot;
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("failed Go upgrade restores go.mod, go.sum, and gomod2nix.toml byte-for-byte", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-update-go-rollback-"));
  const goDir = path.join(root, "projects/apps/go-app");
  const fakeGo = path.join(root, "fake-go.sh");
  const trace = path.join(root, "go-argv.txt");
  try {
    await fsp.mkdir(goDir, { recursive: true });
    const originals = new Map<string, Buffer>([
      ["go.mod", Buffer.from("module example.test/original\n")],
      ["go.sum", Buffer.from([0, 1, 2, 255])],
      ["gomod2nix.toml", Buffer.from("schema = 3\n\n[mod]\n")],
    ]);
    for (const [file, bytes] of originals) await fsp.writeFile(path.join(goDir, file), bytes);
    await fsp.writeFile(
      fakeGo,
      `#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> ${JSON.stringify(trace)}
printf 'mutated\n' > go.mod
if [[ "$*" == "get -u ./..." ]]; then
  exit 0
fi
if [[ "$*" == "mod tidy" ]]; then
  rm -f go.sum
  printf 'mutated\n' > gomod2nix.toml
  exit 7
fi
exit 9
`,
    );
    await fsp.chmod(fakeGo, 0o755);

    await assert.rejects(repairGoDependencies(root, false, true, fakeGo), /exited 7/);
    assert.equal(await fsp.readFile(trace, "utf8"), "get -u ./...\nmod tidy\n");
    for (const [file, bytes] of originals) {
      assert.deepEqual(await fsp.readFile(path.join(goDir, file)), bytes);
    }
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("failed Python upgrade restores existing uv.lock bytes and uses upgrade argv", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-update-python-bytes-"));
  const pythonDir = path.join(root, "projects/apps/python-app");
  const fakeUv = path.join(root, "fake-uv.sh");
  const trace = path.join(root, "uv-argv.txt");
  const original = Buffer.from([0, 1, 2, 255]);
  try {
    await fsp.mkdir(pythonDir, { recursive: true });
    await fsp.writeFile(
      path.join(pythonDir, "pyproject.toml"),
      "[project]\nname='python-app'\nversion='0.1.0'\n",
    );
    await fsp.writeFile(path.join(pythonDir, "uv.lock"), original);
    await fsp.writeFile(
      fakeUv,
      `#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" > ${JSON.stringify(trace)}
printf 'mutated\n' > uv.lock
exit 9
`,
    );
    await fsp.chmod(fakeUv, 0o755);

    await assert.rejects(repairPythonDependencies(root, false, true, fakeUv), /exited 9/);
    assert.equal(await fsp.readFile(trace, "utf8"), "lock --upgrade\n");
    assert.deepEqual(await fsp.readFile(path.join(pythonDir, "uv.lock")), original);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("failed Python upgrade preserves uv.lock absence", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-update-python-rollback-"));
  const pythonDir = path.join(root, "projects/apps/python-app");
  try {
    await fsp.mkdir(pythonDir, { recursive: true });
    await fsp.writeFile(path.join(pythonDir, "pyproject.toml"), "this is not toml = [\n");
    await assert.rejects(repairPythonDependencies(root, false, true), /uv lock --upgrade exited/);
    await assert.rejects(fsp.access(path.join(pythonDir, "uv.lock")), { code: "ENOENT" });
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("u modes preserve source authority while plain u repairs C++ metadata", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-update-boundary-"));
  const protectedFiles = [
    ".gitmodules",
    "flake.nix",
    "flake.lock",
    ".viberoots/bootstrap/transactions/source-mode.json",
  ];
  try {
    await fsp.mkdir(path.join(root, ".viberoots/bootstrap/transactions"), { recursive: true });
    await fsp.mkdir(path.join(root, "projects/apps/web"), { recursive: true });
    await fsp.writeFile(
      path.join(root, ".gitmodules"),
      '[submodule "viberoots"]\n\tpath = viberoots\n\turl = https://example.invalid/viberoots.git\n',
    );
    await fsp.writeFile(
      path.join(root, "flake.nix"),
      'inputs.viberoots.url = "github:viberoots/viberoots/pinned";\n',
    );
    await fsp.writeFile(path.join(root, "flake.lock"), '{"viberoots":"pinned"}\n');
    await fsp.writeFile(
      path.join(root, protectedFiles[3]),
      '{"mode":"submodule","status":"completed"}\n',
    );
    await $({ cwd: root })`git init -q`;
    await $({
      cwd: root,
    })`git update-index --add --cacheinfo 160000,0123456789012345678901234567890123456789,viberoots`;

    const protectedSnapshot = async () => ({
      gitlink: String((await $({ cwd: root })`git ls-files -s viberoots`).stdout).trim(),
      files: await Promise.all(
        protectedFiles.map(async (file) => [
          file,
          await fsp.readFile(path.join(root, file), "utf8"),
        ]),
      ),
    });
    const before = await protectedSnapshot();
    const makeOperations = (): UpdateOperations => ({
      repairToolchainAuthority: async () => ({
        artifactToolsRoot: "/nix/store/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb-artifact-tools",
        viberootsSource: "/nix/store/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-source",
      }),
      importers: async () => ["projects/apps/web"],
      repairPnpmLock: async () => {
        await fsp.writeFile(path.join(root, "projects/apps/web/pnpm-lock.yaml"), "repaired\n");
      },
      upgradePnpm: async () => {
        await fsp.writeFile(
          path.join(root, "projects/apps/web/package.json"),
          '{"upgraded":true}\n',
        );
      },
      reconcilePnpm: async () => {},
      enabledLanguages: async () => ["go", "python", "cpp"],
      languageUpdates: {
        go: async () => 0,
        python: async () => 0,
        cpp: async () => 0,
      },
      repairWorkspaceLock: async () => {},
      repairGeneratedMetadata: async () => {
        await fsp.writeFile(path.join(root, "cpp-provider-metadata.json"), '{"fresh":true}\n');
      },
    });

    await runUpdateCommand({ root, upgrade: false, verbose: false, operations: makeOperations() });
    assert.deepEqual(await protectedSnapshot(), before);
    assert.equal(
      await fsp.readFile(path.join(root, "projects/apps/web/pnpm-lock.yaml"), "utf8"),
      "repaired\n",
    );
    assert.equal(
      await fsp.readFile(path.join(root, "cpp-provider-metadata.json"), "utf8"),
      '{"fresh":true}\n',
    );

    await runUpdateCommand({ root, upgrade: true, verbose: false, operations: makeOperations() });
    assert.deepEqual(await protectedSnapshot(), before);
    assert.equal(
      await fsp.readFile(path.join(root, "projects/apps/web/package.json"), "utf8"),
      '{"upgraded":true}\n',
    );
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

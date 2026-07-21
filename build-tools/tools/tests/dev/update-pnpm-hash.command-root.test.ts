import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { resolveUpdatePnpmHashCommandRoot } from "../../dev/update-pnpm-hash/command-root";
import { repoRelativeLockfilePath } from "../../dev/update-pnpm-hash/paths";

async function writeFile(file: string, content = ""): Promise<void> {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, content, "utf8");
}

test("update-pnpm-hash targets an explicit nested viberoots checkout", async () => {
  const workspace = await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-update-command-root-"));
  try {
    const nested = path.join(workspace, "viberoots");
    const parentSubdir = path.join(workspace, "projects", "app");
    const parentHashes = path.join(workspace, "projects", "config", "node-modules.hashes.json");
    const parentSentinel = '{"projects/apps/demo/pnpm-lock.yaml":"sha256-demo"}\n';
    await writeFile(path.join(workspace, "flake.nix"));
    await writeFile(path.join(workspace, ".viberoots", "workspace", "flake.nix"));
    await writeFile(parentHashes, parentSentinel);
    await fsp.mkdir(parentSubdir, { recursive: true });
    await writeFile(path.join(nested, "flake.nix"));
    await writeFile(path.join(nested, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    await fsp.mkdir(path.join(nested, "build-tools", "tools"), { recursive: true });

    const commandRoot = await resolveUpdatePnpmHashCommandRoot(nested);
    assert.equal(commandRoot, await fsp.realpath(nested));
    assert.equal(repoRelativeLockfilePath(commandRoot, "pnpm-lock.yaml"), "pnpm-lock.yaml");
    assert.equal(
      path.resolve(commandRoot, "pnpm-lock.yaml"),
      path.join(await fsp.realpath(nested), "pnpm-lock.yaml"),
    );
    assert.equal(await fsp.readFile(parentHashes, "utf8"), parentSentinel);
    assert.equal(await resolveUpdatePnpmHashCommandRoot(parentSubdir), path.resolve(workspace));
  } finally {
    await fsp.rm(workspace, { recursive: true, force: true });
  }
});

test("update-pnpm-hash entrypoint uses the command-root resolver", async () => {
  const entrypoint = await fsp.readFile(
    path.resolve(import.meta.dirname, "../../dev/update-pnpm-hash.ts"),
    "utf8",
  );
  assert.match(entrypoint, /resolveUpdatePnpmHashCommandRoot\(process\.cwd\(\)\)/);
  assert.doesNotMatch(entrypoint, /findRepoRoot\(process\.cwd\(\)\)/);
});

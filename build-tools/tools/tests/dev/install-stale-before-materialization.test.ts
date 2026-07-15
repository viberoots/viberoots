#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";

const execFileAsync = promisify(execFile);

async function git(root: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", root, ...args], { encoding: "utf8" });
  return String(stdout || "").trim();
}

test("stale install fails before Nix materialization and u remains available", async (t) => {
  const root = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-stale-i-")));
  const calls = path.join(os.tmpdir(), `vbr-stale-i-nix-${process.pid}-${Date.now()}.log`);
  const sourceRoot = viberootsSourcePath(".");
  t.after(async () => {
    await fsp.rm(root, { recursive: true, force: true });
    await fsp.rm(calls, { force: true });
  });

  await fsp.mkdir(path.join(root, ".viberoots", "workspace"), { recursive: true });
  await fsp.mkdir(path.join(root, "build-tools", "tools", "nix"), { recursive: true });
  await fsp.mkdir(path.join(root, "projects"), { recursive: true });
  await fsp.mkdir(path.join(root, "fake-bin"), { recursive: true });
  await fsp.symlink(sourceRoot, path.join(root, ".viberoots", "current"));
  await fsp.writeFile(path.join(root, ".buckroot"), ".\n");
  await fsp.writeFile(path.join(root, ".gitignore"), ".viberoots/workspace/\n");
  await fsp.writeFile(path.join(root, "flake.nix"), "{ outputs = _: {}; }\n");
  await fsp.writeFile(
    path.join(root, "build-tools", "tools", "nix", "langs.json"),
    '{"enabled":["cpp"]}\n',
  );
  const fakeNix = path.join(root, "fake-bin", "nix");
  await fsp.writeFile(
    fakeNix,
    '#!/usr/bin/env bash\nprintf "%s\\n" "$*" >> "$VBR_FAKE_NIX_LOG"\nexit 97\n',
    { mode: 0o755 },
  );

  await git(root, ["init", "-q"]);
  await git(root, ["add", "."]);
  await execFileAsync("git", [
    "-C",
    root,
    "-c",
    "user.name=test",
    "-c",
    "user.email=test@example.invalid",
    "commit",
    "-qm",
    "fixture",
  ]);
  assert.equal(await git(root, ["status", "--short"]), "");

  const { stdout: updateHelp } = await execFileAsync(
    path.join(sourceRoot, "build-tools", "tools", "bin", "u"),
    ["--help"],
    { cwd: root, env: { ...process.env, WORKSPACE_ROOT: root } },
  );
  assert.match(String(updateHelp), /usage: u \[--upgrade\]/);
  assert.equal(await fsp.stat(path.join(root, "node_modules")).catch(() => null), null);

  const env = {
    ...process.env,
    PATH: `${path.dirname(fakeNix)}:${process.env.PATH || ""}`,
    WORKSPACE_ROOT: root,
    VIBEROOTS_ROOT: sourceRoot,
    VIBEROOTS_SOURCE_ROOT: sourceRoot,
    VBR_NIX_BIN: fakeNix,
    NIX_BIN: fakeNix,
    VBR_FAKE_NIX_LOG: calls,
    VBR_NIX_CACHE_POLICY: "off",
    INSTALL_DEPS_WITHOUT_SECRETS: "1",
  };
  await assert.rejects(
    execFileAsync(
      process.execPath,
      [
        "--experimental-strip-types",
        "--import",
        path.join(sourceRoot, "build-tools", "tools", "dev", "zx-init.mjs"),
        path.join(sourceRoot, "build-tools", "tools", "dev", "install-deps.ts"),
      ],
      { cwd: root, env },
    ),
    (error: Error & { stderr?: string }) => {
      const output = `${error.message}\n${error.stderr || ""}`;
      assert.match(
        output,
        /tracked metadata is stale: (?:\.viberoots\/current\/)?build-tools\/(?:tools\/nix\/langs\.json|lang\/auto_map\.bzl)/,
      );
      assert.match(output, /no tracked files were modified/);
      assert.match(output, /repair: run u/);
      return true;
    },
  );
  assert.equal(await fsp.readFile(calls, "utf8").catch(() => ""), "");
  assert.equal(await git(root, ["status", "--short"]), "");
  assert.equal(await fsp.stat(path.join(root, "node_modules")).catch(() => null), null);
});

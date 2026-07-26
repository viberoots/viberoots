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

async function readRepoFile(relativePath: string): Promise<string> {
  return await fsp.readFile(viberootsSourcePath(relativePath), "utf8");
}

test("verify seed snapshot excludes generated workspace buck state", async () => {
  const source = await readRepoFile("build-tools/tools/nix/flake/packages/filter-seed-repo.nix");
  const seedSource = await readRepoFile("build-tools/tools/nix/flake/packages/test-seed.nix");
  const seedStagingSource = [
    await readRepoFile("build-tools/tools/dev/verify/seed-stage-tree.ts"),
    await readRepoFile("build-tools/tools/dev/verify/seed-stage-source-overlay.ts"),
  ].join("\n");
  const seedCopySource = await readRepoFile(
    "build-tools/tools/tests/lib/test-helpers/seed-copy.ts",
  );
  const seedStoreSource = [
    await readRepoFile("build-tools/tools/tests/lib/test-helpers/seed-store.ts"),
    await readRepoFile("build-tools/tools/tests/lib/test-helpers/seed-worktree-overlay.ts"),
  ].join("\n");
  const rsyncSource = await readRepoFile("build-tools/tools/tests/lib/test-helpers/rsync.ts");
  assert.match(source, /rel == "\.viberoots\/workspace\/buck"/);
  assert.match(source, /lib\.hasPrefix "\.viberoots\/workspace\/buck\/" rel/);
  assert.match(source, /rel == "\.viberoots\/workspace\/\.viberoots"/);
  assert.match(source, /lib\.hasPrefix "\.viberoots\/workspace\/\.viberoots\/" rel/);
  assert.match(source, /rel == "\.viberoots\/workspace\/codex-test-logs"/);
  assert.match(source, /lib\.hasPrefix "\.viberoots\/workspace\/codex-test-logs\/" rel/);
  assert.match(source, /rel == "\.viberoots\/buck"/);
  assert.match(source, /lib\.hasPrefix "\.viberoots\/buck\/" rel/);
  assert.match(source, /rel == "\.viberoots\/cache"/);
  assert.match(source, /lib\.hasPrefix "\.viberoots\/cache\/" rel/);
  assert.match(source, /rel == "\.viberoots\/codex-logs"/);
  assert.match(source, /lib\.hasPrefix "\.viberoots\/codex-logs\/" rel/);
  assert.match(source, /rel == "build-tools\/tmp"/);
  assert.match(source, /lib\.hasPrefix "build-tools\/tmp\/" rel/);
  assert.match(source, /"\.viberoots"/);
  assert.match(source, /builtins\.any \(d: rel == "viberoots\/\$\{d\}"/);
  assert.match(seedSource, /"\$out\/\.viberoots\/buck"/);
  assert.match(seedSource, /"\$out\/\.viberoots\/codex-logs"/);
  assert.match(seedSource, /"\$out\/\.viberoots\/workspace\/\.viberoots"/);
  assert.match(seedSource, /"\$out\/\.viberoots\/workspace\/codex-test-logs"/);
  assert.match(seedSource, /"\$out\/build-tools\/tmp"/);
  assert.match(seedSource, /"\$out\/viberoots\/\.viberoots"/);
  assert.match(seedStagingSource, /isGeneratedRepoStateRelPath/);
  assert.match(seedStagingSource, /hasGeneratedRepoState/);
  assert.match(seedCopySource, /removeGeneratedRepoState/);
  assert.match(seedStoreSource, /isGeneratedRepoStateRelPath/);
  assert.match(seedStoreSource, /if \(isGeneratedRepoStateRelPath\(rel\)\) return false/);
  assert.match(rsyncSource, /\/\.viberoots\/buck/);
  assert.match(rsyncSource, /\/\.viberoots\/codex-logs/);
  assert.match(rsyncSource, /\/\.viberoots\/workspace\/\.viberoots/);
  assert.match(rsyncSource, /\/\.viberoots\/workspace\/codex-test-logs/);
  assert.match(rsyncSource, /\/build-tools\/tmp/);
  assert.match(rsyncSource, /"prelude"/);
  assert.match(rsyncSource, /"patches"/);
  assert.match(rsyncSource, /extractedToolRoots\.has\(r\)/);
});

test("verify seed snapshot excludes disappearing nested Git pack state without losing source", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "verify-seed-vcs-filter-"));
  try {
    const tracked = path.join(root, "viberoots", "src", "tracked.txt");
    const pack = path.join(root, "viberoots", ".git", "objects", "pack");
    await fsp.mkdir(path.dirname(tracked), { recursive: true });
    await fsp.mkdir(pack, { recursive: true });
    await fsp.writeFile(tracked, "tracked-source\n");
    await fsp.symlink(
      path.join(pack, "already-disappeared.rev"),
      path.join(pack, ".tmp-racing-pack.rev"),
    );
    const canonicalRoot = await fsp.realpath(root);
    const filterPath = viberootsSourcePath(
      "build-tools/tools/nix/flake/packages/filter-seed-repo.nix",
    );
    const expression = `
      let
        lib = rec {
          hasPrefix = prefix: value:
            builtins.substring 0 (builtins.stringLength prefix) value == prefix;
          hasSuffix = suffix: value:
            let n = builtins.stringLength value; m = builtins.stringLength suffix;
            in n >= m && builtins.substring (n - m) m value == suffix;
          hasInfix = infix: value: builtins.match ".*\${infix}.*" value != null;
          removePrefix = prefix: value:
            builtins.substring (builtins.stringLength prefix)
              (builtins.stringLength value - builtins.stringLength prefix) value;
          elem = builtins.elem;
          any = builtins.any;
          head = builtins.head;
          splitString = separator: value:
            builtins.filter builtins.isString (builtins.split separator value);
        };
        filterSeed = import ${JSON.stringify(filterPath)} {
          inherit lib;
          roots = [];
        };
        snapshot = builtins.path {
          path = builtins.toPath ${JSON.stringify(canonicalRoot)};
          name = "verify-seed-vcs-filter";
          filter = filterSeed (builtins.toPath ${JSON.stringify(canonicalRoot)});
        };
      in {
        tracked = builtins.readFile (snapshot + "/viberoots/src/tracked.txt");
        nestedGitPresent = builtins.pathExists (snapshot + "/viberoots/.git");
      }
    `;
    const evaluated = await execFileAsync(
      "nix",
      ["eval", "--impure", "--json", "--expr", expression],
      { env: process.env },
    );
    assert.deepEqual(JSON.parse(evaluated.stdout), {
      nestedGitPresent: false,
      tracked: "tracked-source\n",
    });
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { collectChangedPaths } from "../../lib/build-system-test-scope";
import { resolveProjectEnforcementSelection } from "../../dev/verify/project-enforcement-selection";
import { realGit } from "../dev/git-wrapper-test-helpers";

async function git(root: string, ...args: string[]): Promise<void> {
  await $({ cwd: root })`git ${args}`;
}

async function selection(root: string) {
  return await resolveProjectEnforcementSelection({
    root,
    requestedTargets: ["//:focused"],
    fullSuite: false,
    env: {},
  });
}

async function selected(root: string): Promise<boolean> {
  return (await selection(root)).required;
}

test("project change authority covers committed and every dirty worktree state", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "project-enforcement-git-"));
  const project = path.join(root, "projects/app");
  await fsp.mkdir(project, { recursive: true });
  await fsp.writeFile(path.join(project, "base.ts"), "export const base = 1;\n");
  await fsp.writeFile(path.join(root, "outside.ts"), "export const outside = 1;\n");
  await git(root, "init", "-b", "main");
  await git(root, "add", ".");
  await git(
    root,
    "-c",
    "user.name=test",
    "-c",
    "user.email=test@example.com",
    "commit",
    "-m",
    "base",
  );
  await git(root, "switch", "-c", "feature");

  const committed = path.join(project, "committed.ts");
  await fsp.writeFile(committed, "export const committed = 1;\n");
  await git(root, "add", ".");
  await git(
    root,
    "-c",
    "user.name=test",
    "-c",
    "user.email=test@example.com",
    "commit",
    "-m",
    "project",
  );
  assert.equal(await selected(root), true, "committed project change");
  await git(root, "reset", "--hard", "main");

  await fsp.writeFile(path.join(project, "staged.ts"), "export const staged = 1;\n");
  await git(root, "add", ".");
  assert.equal(await selected(root), true, "staged project change");
  await git(root, "reset", "--hard", "HEAD");

  await fsp.writeFile(path.join(project, "base.ts"), "export const base = 2;\n");
  assert.equal(await selected(root), true, "unstaged project change");
  await git(root, "reset", "--hard", "HEAD");

  await fsp.writeFile(path.join(project, "untracked.ts"), "export const untracked = 1;\n");
  assert.equal(await selected(root), true, "untracked project change");
  await fsp.rm(path.join(project, "untracked.ts"));

  await git(root, "mv", "projects/app/base.ts", "projects/app/renamed.ts");
  assert.equal(await selected(root), true, "renamed project change");
  await git(root, "reset", "--hard", "HEAD");

  await fsp.rm(path.join(project, "base.ts"));
  assert.equal(await selected(root), true, "deleted project change");

  const nonRepo = await fsp.mkdtemp(path.join(os.tmpdir(), "project-enforcement-no-git-"));
  const unavailable = await resolveProjectEnforcementSelection({
    root: nonRepo,
    requestedTargets: ["//:focused"],
    fullSuite: false,
  });
  assert.equal(unavailable.reason, "unavailable-change-authority");
});

test("committed rename authority preserves both sides across the projects boundary", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "project-enforcement-renames-"));
  await fsp.mkdir(path.join(root, "projects/app"), { recursive: true });
  await fsp.writeFile(path.join(root, "projects/app/base.ts"), "export const base = 1;\n");
  await fsp.writeFile(path.join(root, "outside.ts"), "export const outside = 1;\n");
  await git(root, "init", "-b", "main");
  await git(root, "add", ".");
  await git(
    root,
    "-c",
    "user.name=test",
    "-c",
    "user.email=test@example.com",
    "commit",
    "-m",
    "base",
  );
  await git(root, "switch", "-c", "feature");

  const cases = [
    ["outside.ts", "projects/app/incoming.ts"],
    ["projects/app/base.ts", "moved-out.ts"],
    ["projects/app/base.ts", "projects/app/within.ts"],
  ] as const;
  for (const [from, to] of cases) {
    await git(root, "reset", "--hard", "main");
    await git(root, "mv", from, to);
    await git(
      root,
      "-c",
      "user.name=test",
      "-c",
      "user.email=test@example.com",
      "commit",
      "-m",
      `rename ${from}`,
    );
    const result = await selection(root);
    assert.equal(result.reason, "project-change", `${from} -> ${to}`);
    assert.ok(result.changedPaths.includes(from), `missing rename source ${from}`);
    assert.ok(result.changedPaths.includes(to), `missing rename destination ${to}`);
  }
});

test("git discovery failures remain distinct from a successful empty change set", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "project-enforcement-git-failures-"));
  await fsp.writeFile(path.join(root, "base.ts"), "export const base = 1;\n");
  await git(root, "init", "-b", "main");
  await git(root, "add", ".");
  await git(
    root,
    "-c",
    "user.name=test",
    "-c",
    "user.email=test@example.com",
    "commit",
    "-m",
    "base",
  );
  await git(root, "switch", "-c", "feature");
  await fsp.writeFile(path.join(root, "feature.ts"), "export const feature = 1;\n");
  await git(root, "add", ".");
  await git(
    root,
    "-c",
    "user.name=test",
    "-c",
    "user.email=test@example.com",
    "commit",
    "-m",
    "feature",
  );

  const bin = await fsp.mkdtemp(path.join(os.tmpdir(), "project-enforcement-fake-git-"));
  const realGitPath = await realGit();
  await fsp.writeFile(
    path.join(bin, "git"),
    [
      "#!/usr/bin/env bash",
      'if [[ -n "$FAIL_MATCH" && " $* " == *"$FAIL_MATCH"* ]]; then',
      '  printf "forced git failure: %s\\n" "$FAIL_MATCH" >&2',
      "  exit 2",
      "fi",
      'exec "$REAL_GIT" "$@"',
      "",
    ].join("\n"),
    { mode: 0o755 },
  );

  const original = {
    path: process.env.PATH,
    realGit: process.env.REAL_GIT,
    failMatch: process.env.FAIL_MATCH,
  };
  try {
    process.env.PATH = `${bin}${path.delimiter}${original.path || ""}`;
    process.env.REAL_GIT = realGitPath;
    for (const command of [
      "rev-parse --verify --quiet main",
      "merge-base main HEAD",
      "diff --name-status -z --find-renames",
      "status --porcelain=v1 -z --untracked-files=all",
    ]) {
      process.env.FAIL_MATCH = command;
      const result = await collectChangedPaths(root, {});
      assert.equal(result.ok, false, command);
      if (result.ok) continue;
      assert.match(result.reason, new RegExp(command.split(" ")[0]!));
      const conservative = await resolveProjectEnforcementSelection({
        root,
        requestedTargets: ["//:focused"],
        fullSuite: false,
        changedPathsResult: result,
      });
      assert.equal(conservative.reason, "unavailable-change-authority");
      assert.match(conservative.changeAuthorityFailure || "", /forced git failure/);
    }
    delete process.env.FAIL_MATCH;
    await git(root, "reset", "--hard", "main");
    const empty = await collectChangedPaths(root, {});
    assert.deepEqual(empty, { ok: true, paths: [] });
    const noChange = await resolveProjectEnforcementSelection({
      root,
      requestedTargets: ["//:focused"],
      fullSuite: false,
      changedPathsResult: empty,
    });
    assert.equal(noChange.reason, "not-required");
  } finally {
    process.env.PATH = original.path;
    if (original.realGit === undefined) delete process.env.REAL_GIT;
    else process.env.REAL_GIT = original.realGit;
    if (original.failMatch === undefined) delete process.env.FAIL_MATCH;
    else process.env.FAIL_MATCH = original.failMatch;
    await fsp.unlink(path.join(bin, "git")).catch(() => undefined);
    await fsp.rmdir(bin).catch(() => undefined);
  }
});

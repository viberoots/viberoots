#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { resolveProjectEnforcementSelection } from "../../dev/verify/project-enforcement-selection";

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

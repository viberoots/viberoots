#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { createFreshCloneFixture, git } from "./fresh-clone-post-clone.fixture";

test("fresh recursive clone runs real post-clone initialization without tracked mutation", async (t) => {
  const fixture = await createFreshCloneFixture(t);
  const { commandEnv, consumerSource, submoduleRev } = fixture;
  assert.equal(
    JSON.parse(await fsp.readFile(path.join(consumerSource, "flake.lock"), "utf8")).nodes.viberoots
      .locked.rev,
    submoduleRev,
  );

  const clone = await fixture.clone("clone");
  assert.equal(await git(path.join(clone, "viberoots"), ["rev-parse", "HEAD"]), submoduleRev);
  await fsp.writeFile(fixture.nixLog, "");
  const { stdout } = await fixture.postClone(clone, { runInstall: true });
  assert.match(stdout, /status bootstrapped/);
  assert.match(stdout, /workspace initialized/);
  assert.match(
    stdout,
    /cold importer metadata is fresh: projects\/apps\/viberoots-site\/pnpm-lock\.yaml/,
  );
  assert.equal(await fsp.readlink(path.join(clone, ".viberoots", "current")), "../viberoots");
  for (const rel of ["flake.nix", "flake.lock", "TARGETS"]) {
    await fsp.access(path.join(clone, ".viberoots", "workspace", rel));
  }
  const { stdout: statusText } = await fixture.runCommand(["status", "--json"], clone, {
    ...commandEnv,
    WORKSPACE_ROOT: clone,
  });
  assert.equal(JSON.parse(statusText).sourceMode, "local");
  assert.equal(await git(clone, ["diff", "--name-only"]), "");
  assert.equal(await git(clone, ["status", "--short"]), "");

  const rootLock = JSON.parse(await fsp.readFile(path.join(clone, "flake.lock"), "utf8"));
  const workspaceLock = JSON.parse(
    await fsp.readFile(path.join(clone, ".viberoots", "workspace", "flake.lock"), "utf8"),
  );
  for (const [name, node] of Object.entries(rootLock.nodes)) {
    if (name !== "viberoots") assert.deepEqual(workspaceLock.nodes[name], node);
  }
  assert.equal(workspaceLock.nodes.viberoots.locked.path, "./viberoots-flake-input");
  const nixInvocations = await fsp.readFile(fixture.nixLog, "utf8");
  assert.doesNotMatch(nixInvocations, /nix flake (?:lock|update|metadata)\b/);
});

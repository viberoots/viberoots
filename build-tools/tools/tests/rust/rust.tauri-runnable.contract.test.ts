#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { directTauriDevSpec } from "../../dev/run-runnable-dev-spec";
import { runRunnable } from "../../dev/run-runnable";
import { inferRunnableFromOutPath } from "../../lib/runnables";

test("Tauri run.dev resolves to the explicit bounded desktop watcher", async () => {
  const expected = directTauriDevSpec(
    "/workspace",
    "//projects/apps/desktop:desktop",
    "/nix/store/artifact-tools",
  );
  assert.match(expected.argv[1] || "", /tauri-dev\.ts$/);
  let executed: { argv: string[]; cwd?: string; env?: NodeJS.ProcessEnv } | undefined;
  await runRunnable({
    argv: ["--mode", "dev", "//projects/apps/desktop:desktop"],
    workspaceRoot: "/workspace",
    artifactToolsRoot: "/nix/store/artifact-tools",
    resolveEntry: async () => ({
      label: "//projects/apps/desktop:desktop",
      kind: "app",
      runnable: {
        kind: "desktop-app",
        run: {
          prod: { argv: ["/nix/store/app/bin/desktop"] },
          dev: { argv: ["viberoots-tauri-dev", "//projects/apps/desktop:desktop"] },
        },
      },
    }),
    executeCommand: async (argv, _extra, cwd, env) => {
      executed = { argv, cwd, env };
      return 0;
    },
  });
  assert.deepEqual(executed?.argv, expected.argv);
  assert.equal(executed?.cwd, "/workspace");
  assert.equal(executed?.env?.VBR_CANONICAL_ARTIFACT_ENTRYPOINT, undefined);
});

test("selected Tauri output inference preserves desktop artifacts and explicit dev", async () => {
  const root = await fsp.mkdtemp(path.join(process.env.TMPDIR || "/tmp", "tauri-runnable-"));
  try {
    await fsp.mkdir(path.join(root, "bin"), { recursive: true });
    const appExecutable = path.join(root, "app", "desktop.app", "Contents", "MacOS", "desktop");
    await fsp.mkdir(path.dirname(appExecutable), { recursive: true });
    await fsp.mkdir(path.join(root, "share/viberoots-tauri"), { recursive: true });
    const bin = path.join(root, "bin/desktop");
    await fsp.writeFile(bin, "#!/bin/sh\n");
    await fsp.chmod(bin, 0o755);
    await fsp.writeFile(appExecutable, "#!/bin/sh\n");
    await fsp.chmod(appExecutable, 0o755);
    await fsp.writeFile(
      path.join(root, "share/viberoots-tauri/artifact-manifest.json"),
      `${JSON.stringify({
        schema: "viberoots.tauri-artifact.v1",
        appExecutable,
        signature: {
          mode: "adhoc-platform",
          credentialed: false,
          teamIdentifier: null,
          signingIdentity: null,
          releaseSigned: false,
          releaseAdmitted: false,
        },
      })}\n`,
    );
    const runnable = await inferRunnableFromOutPath({
      label: "//projects/apps/desktop:desktop",
      outPath: root,
    });
    assert.equal(runnable?.kind, "desktop-app");
    assert.deepEqual(runnable?.run.prod.argv, [appExecutable]);
    assert.deepEqual(runnable?.run.dev?.argv, [
      "viberoots-tauri-dev",
      "//projects/apps/desktop:desktop",
    ]);
    assert.equal(runnable?.artifacts?.applicationBundle, path.join(root, "app"));
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("patch-go apply supports --force overwrite when patch exists with different content", async () => {
  await runInTemp("patch-go-apply-force", async (tmp, $) => {
    const origin = path.join(tmp, "gomodcache", "golang.org/x/net@v0.24.0");
    await fs.mkdirp(origin);
    await fs.outputFile(path.join(origin, "file.txt"), "A\n", "utf8");
    const resolveMap = { "golang.org/x/net": { version: "v0.24.0", originPath: origin } };

    await $`chmod +x tools/bin/patch-pkg`;
    // Start a session and capture the workspace + session store to read originPath
    const startOut = await $({
      cwd: tmp,
      stdio: "pipe",
    })`WORKSPACE_ROOT=${tmp} NIX_GO_TEST_RESOLVE_JSON=${JSON.stringify(
      resolveMap,
    )} NIX_GO_DEV_OVERRIDE_JSON={} GOMODCACHE=${path.join(tmp, "gomodcache")} tools/bin/patch-pkg start go golang.org/x/net`;
    const ws = String(startOut.stdout || "")
      .trim()
      .split(/\s+/)
      .pop() as string;
    if (!ws) {
      console.error("missing workspace path from start");
      process.exit(2);
    }
    // Read session store to capture the originPath (for later re-seeding the session)
    const store = JSON.parse(
      await fs.readFile(path.join(tmp, ".patch-sessions.json"), "utf8"),
    ) as any;
    const rec = store.sessions?.go?.["golang.org/x/net@v0.24.0"];
    if (!rec?.originPath) {
      console.error("missing originPath in session store");
      process.exit(2);
    }
    const originPath = rec.originPath as string;

    // Make a change and apply to create initial patch (A -> B)
    await fsp.writeFile(path.join(ws, "file.txt"), "B\n", "utf8");
    const apply1 = await $({
      cwd: tmp,
      stdio: "pipe",
    })`WORKSPACE_ROOT=${tmp} NIX_GO_TEST_RESOLVE_JSON=${JSON.stringify(
      resolveMap,
    )} NIX_GO_DEV_OVERRIDE_JSON={} GOMODCACHE=${path.join(
      tmp,
      "gomodcache",
    )} tools/bin/patch-pkg apply go golang.org/x/net --target //libs/core:lib`;
    if ((apply1.exitCode || 0) !== 0) {
      console.error("initial apply failed:", String(apply1.stderr || ""));
      process.exit(2);
    }
    const patchPath = path.join(
      tmp,
      "libs",
      "core",
      "patches",
      "go",
      "golang.org__x__net@v0.24.0.patch",
    );
    const firstContent = await fs.readFile(patchPath, "utf8");
    if (!firstContent.includes("+B")) {
      console.error("initial patch content did not include expected change to 'B'");
      process.exit(2);
    }

    // Modify workspace again (A -> C), then try apply WITHOUT --force (should fail)
    await fsp.writeFile(path.join(ws, "file.txt"), "C\n", "utf8");
    // Re-seed a session record pointing to the existing workspace so apply can proceed
    const newStore = {
      version: 1,
      sessions: {
        go: {
          "golang.org/x/net@v0.24.0": {
            importPath: "golang.org/x/net",
            version: "v0.24.0",
            originPath,
            workspacePath: ws,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        },
      },
    };
    await fs.writeFile(
      path.join(tmp, ".patch-sessions.json"),
      JSON.stringify(newStore, null, 2) + "\n",
      "utf8",
    );

    const applyNoForce = await $({
      cwd: tmp,
      stdio: "pipe",
    })`WORKSPACE_ROOT=${tmp} NIX_GO_TEST_RESOLVE_JSON=${JSON.stringify(
      resolveMap,
    )} NIX_GO_DEV_OVERRIDE_JSON={} GOMODCACHE=${path.join(
      tmp,
      "gomodcache",
    )} tools/bin/patch-pkg apply go golang.org/x/net --target //libs/core:lib`.nothrow();
    if ((applyNoForce.exitCode || 0) === 0) {
      console.error(
        "apply without --force should have failed due to different existing patch content",
      );
      process.exit(2);
    }
    const errTxt = String(applyNoForce.stdout || "") + String(applyNoForce.stderr || "");
    if (!/exists with different content/i.test(errTxt)) {
      console.error("expected overwrite guidance when patch differs");
      process.exit(2);
    }

    // Now apply with --force, should overwrite patch and verify via dry-run
    const applyForce = await $({
      cwd: tmp,
      stdio: "pipe",
    })`WORKSPACE_ROOT=${tmp} NIX_GO_TEST_RESOLVE_JSON=${JSON.stringify(
      resolveMap,
    )} NIX_GO_DEV_OVERRIDE_JSON={} GOMODCACHE=${path.join(
      tmp,
      "gomodcache",
    )} tools/bin/patch-pkg apply go golang.org/x/net --target //libs/core:lib --force`;
    if ((applyForce.exitCode || 0) !== 0) {
      console.error("apply with --force should have succeeded");
      console.error(String(applyForce.stderr || ""));
      process.exit(2);
    }
    const secondContent = await fs.readFile(patchPath, "utf8");
    if (secondContent === firstContent || !secondContent.includes("+C")) {
      console.error("expected patch file to be overwritten with new content including '+C'");
      process.exit(2);
    }
  });
});

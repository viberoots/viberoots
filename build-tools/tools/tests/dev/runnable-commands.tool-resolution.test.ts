#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runCommand } from "../../dev/run-runnable-core";

test("runnable Python bypasses a hostile host PATH entry for the Nix-store tool", async () => {
  const root = await fsp.mkdtemp(
    path.join(process.cwd(), ".viberoots/workspace/buck/tmp/python-path-"),
  );
  const hostBin = path.join(root, "host-bin");
  const hostMarker = path.join(root, "host-python-ran");
  const storeMarker = path.join(root, "store-python-ran");
  const originalPath = process.env.PATH;
  try {
    await fsp.mkdir(hostBin, { recursive: true });
    const hostilePython = path.join(hostBin, "python3");
    await fsp.writeFile(hostilePython, `#!/bin/sh\n: > '${hostMarker}'\nexit 91\n`, "utf8");
    await fsp.chmod(hostilePython, 0o755);
    process.env.PATH = `${hostBin}${path.delimiter}${originalPath || ""}`;

    const code = await runCommand(
      [
        "python3",
        "-c",
        `from pathlib import Path; Path(${JSON.stringify(storeMarker)}).write_text('ok')`,
      ],
      [],
    );
    assert.equal(code, 0);
    assert.equal(await fsp.readFile(storeMarker, "utf8"), "ok");
    await assert.rejects(fsp.access(hostMarker));
  } finally {
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("runnable Python rejects an absolute command in a nested fake Nix store", async () => {
  const fakePython = path.join(
    process.cwd(),
    ".viberoots/workspace/buck/tmp/nix/store/hostile/bin/python3",
  );
  await assert.rejects(
    runCommand([fakePython, "-c", "raise SystemExit(0)"], []),
    /runnable tool must resolve to \/nix\/store/,
  );
});

test("runnable pnpm strips orchestration preloads and preserves other Node options", async () => {
  const root = await fsp.mkdtemp(
    path.join(process.cwd(), ".viberoots/workspace/buck/tmp/runnable-pnpm-env-"),
  );
  const fakePnpm = path.join(root, "pnpm");
  const capture = path.join(root, "node-options.txt");
  const originalNodeOptions = process.env.NODE_OPTIONS;
  try {
    await fsp.writeFile(
      fakePnpm,
      `#!/bin/sh\nprintf '%s' "${"$"}{NODE_OPTIONS-}" > "${capture}"\n`,
      "utf8",
    );
    await fsp.chmod(fakePnpm, 0o755);
    process.env.NODE_OPTIONS = [
      "--trace-warnings",
      "--import",
      path.join(process.cwd(), "build-tools/tools/dev/zx-init.mjs"),
      "--max-old-space-size=256",
    ].join(" ");

    assert.equal(await runCommand([fakePnpm], []), 0);
    assert.equal(await fsp.readFile(capture, "utf8"), "--trace-warnings --max-old-space-size=256");
  } finally {
    if (originalNodeOptions === undefined) delete process.env.NODE_OPTIONS;
    else process.env.NODE_OPTIONS = originalNodeOptions;
    await fsp.rm(root, { recursive: true, force: true });
  }
});

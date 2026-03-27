#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { resolveToolPathSync } from "../../lib/tool-paths.ts";

test("resolveToolPathSync prefers nix store binaries before host PATH entries", async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "tool-paths-"));
  try {
    const hostDir = path.join(tmp, "host");
    const nixDir = path.join(tmp, "nix", "store", "abc-tool", "bin");
    await fsp.mkdir(hostDir, { recursive: true });
    await fsp.mkdir(nixDir, { recursive: true });
    const hostTool = path.join(hostDir, "demo-tool");
    const nixTool = path.join(nixDir, "demo-tool");
    await fsp.writeFile(hostTool, "#!/bin/sh\nexit 0\n", "utf8");
    await fsp.writeFile(nixTool, "#!/bin/sh\nexit 0\n", "utf8");
    await fsp.chmod(hostTool, 0o755);
    await fsp.chmod(nixTool, 0o755);

    const resolved = resolveToolPathSync("demo-tool", {
      ...process.env,
      PATH: [hostDir, nixDir].join(path.delimiter),
    });
    assert.equal(resolved, nixTool);
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

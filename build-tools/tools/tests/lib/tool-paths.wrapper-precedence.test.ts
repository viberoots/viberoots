import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { resolveToolPathSync } from "../../lib/tool-paths";

test("tool resolution skips viberoots wrappers backed by a Nix store source", async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "tool-paths-"));
  try {
    const wrapperDir = path.join(tmp, "viberoots", "build-tools", "tools", "bin");
    await fsp.mkdir(wrapperDir, { recursive: true });
    await fsp.symlink(process.execPath, path.join(wrapperDir, "node"));

    const resolved = resolveToolPathSync("node", {
      ...process.env,
      PATH: [wrapperDir, path.dirname(process.execPath)].join(path.delimiter),
    });
    assert.equal(resolved, path.join(path.dirname(process.execPath), "node"));
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

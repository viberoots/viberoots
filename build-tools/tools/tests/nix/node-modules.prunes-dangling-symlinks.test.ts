#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import { test } from "node:test";

test("node-modules derivation prunes dangling symlinks before fixup", async () => {
  const txt = await fsp.readFile(
    "viberoots/build-tools/tools/nix/node-modules/modules.nix",
    "utf8",
  );
  if (!txt.includes("pruning dangling symlinks before fixup")) {
    throw new Error("modules.nix must log dangling symlink cleanup before fixup");
  }
  if (!txt.includes('find "$out" -type l ! -exec test -e {}')) {
    throw new Error("modules.nix must detect dangling symlinks in the installed output");
  }
});

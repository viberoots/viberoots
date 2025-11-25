#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { scanFlatPatchDir } from "../../lib/provider-sync";
import { decodeNameVersionFromPatch } from "../../lib/providers";

async function mkTmpDir(): Promise<string> {
  const base = await fsp.mkdtemp(path.join(os.tmpdir(), "bucknix-parity-"));
  return base;
}

test("TS<->Nix patch key parity for patchesMapFromDir", async () => {
  const dir = await mkTmpDir();
  try {
    // Create a few representative patch filenames
    const files = [
      "leftpad@1.3.0.patch",
      "lodash__core@4.17.21.patch",
      "@scope__pkg@1.2.3.patch",
      ".gitkeep", // should be ignored
      "NOT_A_PATCH.txt", // should be ignored
    ];
    for (const f of files) {
      const p = path.join(dir, f);
      // Only write content for .patch to keep the directory tidy
      if (f.endsWith(".patch")) {
        await fsp.writeFile(p, "# test patch\n");
      } else {
        await fsp.writeFile(p, "");
      }
    }

    // TS side: use the shared scan helper with decodeNameVersionFromPatch
    const scanned = await scanFlatPatchDir({
      patchDir: dir,
      decodeKey: decodeNameVersionFromPatch,
      nameForKey: (k) => k,
    });
    const tsKeys = scanned.map((e) => e.key).sort();

    // Nix side: evaluate patchesMapFromDir over the same directory
    const expr = `
      let
        pkgs = import <nixpkgs> {};
        lib = import ./tools/nix/lib/lang-helpers.nix { inherit pkgs; };
      in builtins.attrNames (lib.patchesMapFromDir (builtins.toPath ${JSON.stringify(dir)}))
    `;
    const { stdout } = await $`nix eval --impure --json --expr ${expr}`;
    const nixKeys = JSON.parse(stdout || "[]") as string[];
    nixKeys.sort();

    // Compare sets
    const a = tsKeys.join("\n");
    const b = nixKeys.join("\n");
    if (a !== b) {
      console.error("TS keys:\n", tsKeys);
      console.error("Nix keys:\n", nixKeys);
      throw new Error("TS <-> Nix patch key sets do not match");
    }
  } finally {
    // Best-effort cleanup
    try {
      const names = await fsp.readdir(dir);
      for (const n of names) await fsp.rm(path.join(dir, n));
      await fsp.rmdir(dir);
    } catch {
      // ignore
    }
  }
});

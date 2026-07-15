#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runGomod2nixGenerateIn } from "../../dev/install/gomod2nix";
import { runInTemp } from "../lib/test-helpers";

test("install-deps gomod2nix dry-run logs command and does not write file", async () => {
  await runInTemp("install-deps-dry-run", async (tmp) => {
    const goMod = ["module example.com/demo", "\ngo 1.22"].join("\n");
    await fsp.writeFile(path.join(tmp, "go.mod"), goMod, "utf8");
    await fsp.writeFile(path.join(tmp, "go.sum"), "", "utf8");
    const output: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => output.push(args.map(String).join(" "));
    try {
      await runGomod2nixGenerateIn(tmp, true, false);
    } finally {
      console.log = originalLog;
    }
    const out = output.join("\n");
    if (!out.includes("[gomod2nix] dry-run: ")) {
      console.error("expected dry-run log for gomod2nix");
      process.exit(2);
    }
    const exists = await fsp
      .access(path.join(tmp, "gomod2nix.toml"))
      .then(() => true)
      .catch(() => false);
    if (exists) {
      console.error("gomod2nix.toml should not be written in dry-run");
      process.exit(2);
    }
  });
});

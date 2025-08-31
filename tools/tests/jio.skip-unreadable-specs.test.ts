#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { runInTemp } from "./lib/test-helpers";

// Verify unreadable specs are skipped with a warning
describe("jio skips unreadable specs", () => {
  test("unreadable .tool.json produces warning and continues", async () => {
    await runInTemp("jio-skip-unreadable", async (tmp, $) => {
      await fsp.writeFile(
        path.join(tmp, ".jio"),
        JSON.stringify({
          defaultPackage: "io.example",
          globs: ["**/*.tool.json"],
          excludeGlobs: [],
        }),
        "utf8",
      );
      const dir = path.join(tmp, "t");
      await fsp.mkdir(dir, { recursive: true });
      const bad = path.join(dir, "bad.tool.json");
      await fsp.writeFile(bad, "{not json}", "utf8");
      const out = await $({ stdio: "pipe" })`jio --list`;
      const stderr = String(out.stderr || out.stdout || "");
      if (!/unreadable spec skipped/i.test(stderr)) {
        console.error("expected unreadable spec skipped warning, got:\n" + stderr);
        process.exit(2);
      }
    });
  });
});

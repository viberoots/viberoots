#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { lintFlatPatchDir } from "../../dev/patches-lint/flat-patch-dir-lint";
import { runInTemp } from "../lib/test-helpers";

test("patches-lint: shared flat helper reports nonpatch, filename shape, and duplicates", async () => {
  await runInTemp("patches-lint-flat-helper", async (tmp) => {
    const dir = path.join(tmp, "patches", "go");
    await fsp.mkdir(dir, { recursive: true });

    await fsp.writeFile(path.join(dir, "foo.txt"), "nope\n", "utf8");
    await fsp.writeFile(path.join(dir, "missing-at-separator.patch"), "# bad\n", "utf8");
    await fsp.writeFile(
      path.join(dir, "github.com____acme__widget@v1.2.3.patch"),
      "# one\n",
      "utf8",
    );
    await fsp.writeFile(
      path.join(dir, "github.com__acme____widget@v1.2.3.patch"),
      "# two\n",
      "utf8",
    );

    const cfg = { strict: false, lang: "", format: "json" as const };
    const vs = await lintFlatPatchDir({
      cfg,
      lang: "go",
      patchDirAbs: dir,
      duplicateViolationFilePath: (base) => base,
    });

    const codes = vs.map((v) => v.code).sort();
    if (
      !codes.includes("nonpatch") ||
      !codes.includes("filename_shape") ||
      !codes.includes("duplicate")
    ) {
      console.error("expected nonpatch + filename_shape + duplicate codes, got:", codes);
      process.exit(2);
    }
    const dup = vs.find((v) => v.code === "duplicate");
    if (!dup || dup.moduleKey !== "github.com/acme/widget@v1.2.3") {
      console.error("expected duplicate moduleKey github.com/acme/widget@v1.2.3, got:", dup);
      process.exit(2);
    }
  });
});

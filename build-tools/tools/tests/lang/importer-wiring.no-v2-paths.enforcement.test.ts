#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import * as fsp from "node:fs/promises";
import fg from "fast-glob";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

test("preferred importer wiring surfaces do not use v2 filenames/import paths", async () => {
  const files = await fg(
    [
      "build-tools/lang/**/*.bzl",
      "docs/handbook/**/*.md",
      "abstractions.md",
      "getting-started-on-a-pr.md",
    ],
    {
      dot: false,
      onlyFiles: true,
      followSymbolicLinks: false,
      ignore: ["buck-out/**", "node_modules/**", "coverage/**"],
    },
  );

  for (const file of files) {
    const txt = await fsp.readFile(file, "utf8");
    assert(
      !txt.includes("importer_wiring_v2"),
      `${file} must not reference importer_wiring_v2; use canonical importer_wiring file names`,
    );
  }
});

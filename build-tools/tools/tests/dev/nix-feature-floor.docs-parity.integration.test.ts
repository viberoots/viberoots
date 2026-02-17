#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import { test } from "node:test";

test("docs align on implementation-required nix feature floor", async () => {
  const files = [
    "build-tools/docs/build-system-design.md",
    "build-tools/docs/remote-build-setup.md",
    "docs/handbook/getting-started-on-a-pr.md",
  ];
  for (const file of files) {
    const txt = await fsp.readFile(file, "utf8");
    if (!txt.includes("nix-command") || !txt.includes("flakes")) {
      throw new Error(
        `${file} must mention implementation-required features nix-command and flakes`,
      );
    }
  }
});

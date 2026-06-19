#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import { test } from "node:test";

function sourcePath(rel: string): string {
  if (rel.startsWith("viberoots/")) return rel;
  return `viberoots/${rel}`;
}

test("docs align on implementation-required nix feature floor", async () => {
  const files = [
    "viberoots/build-tools/docs/build-system-design.md",
    "viberoots/build-tools/docs/remote-build-setup.md",
    "docs/handbook/getting-started-on-a-pr.md",
  ];
  for (const file of files) {
    const resolved = sourcePath(file);
    const txt = await fsp.readFile(resolved, "utf8");
    if (!txt.includes("nix-command") || !txt.includes("flakes")) {
      throw new Error(
        `${file} must mention implementation-required features nix-command and flakes`,
      );
    }
  }
});

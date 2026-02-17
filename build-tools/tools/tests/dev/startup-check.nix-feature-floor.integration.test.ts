#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import { test } from "node:test";

test("startup-check enforces implementation-required nix feature floor only", async () => {
  const txt = await fsp.readFile("build-tools/tools/dev/startup-check.ts", "utf8");
  if (!txt.includes('if (!features.has("nix-command"))')) {
    throw new Error("startup-check.ts must require nix-command");
  }
  if (!txt.includes('if (!features.has("flakes"))')) {
    throw new Error("startup-check.ts must require flakes");
  }
  if (txt.includes("missing nix experimental feature: dynamic-derivations")) {
    throw new Error("startup-check.ts must not require dynamic-derivations");
  }
  if (txt.includes("missing nix experimental feature: recursive-nix")) {
    throw new Error("startup-check.ts must not require recursive-nix");
  }
  if (txt.includes("missing nix experimental feature: ca-derivations")) {
    throw new Error("startup-check.ts must not require ca-derivations");
  }
});

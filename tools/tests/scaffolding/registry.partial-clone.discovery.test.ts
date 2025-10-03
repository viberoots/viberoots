#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

// PR 7: partial-clone friendly: presence of files enables language; absence hides it

test("scaffolding registry: discovery only lists present languages and allows others to work", async () => {
  await runInTemp("scaf-partial-clone", async (tmp, $) => {
    // Create a minimal partial checkout that includes only Go
    await fsp.mkdir(path.join(tmp, "tools/nix/templates"), { recursive: true });
    await fsp.mkdir(path.join(tmp, "tools/scaffolding/templates/go"), { recursive: true });
    await fsp.mkdir(path.join(tmp, "go"), { recursive: true });

    // Required files for Go
    await fsp.writeFile(
      path.join(tmp, "tools/nix/templates/go.nix"),
      "# stub go template\n",
      "utf8",
    );
    await fsp.writeFile(path.join(tmp, "go/defs.bzl"), "# stub go defs\n", "utf8");
    await fsp.writeFile(path.join(tmp, "tools/scaffolding/templates/go/.keep"), "", "utf8");

    // languages list should include 'go' only
    const langs = await $({ stdio: "pipe" })`node tools/scaffolding/scaf.ts templates --json`;
    const arr = JSON.parse(String(langs.stdout || "[]"));
    const present = Array.from(new Set(arr.map((x: any) => x.language)));
    if (!(present.length === 1 && present[0] === "go")) {
      console.error("expected only 'go' to be listed in templates, got:", present);
      process.exit(2);
    }

    // Attempt to scaffold a missing language (e.g., rust) should fail gracefully
    let failed = false;
    try {
      await $({ stdio: "pipe" })`node tools/scaffolding/scaf.ts new rust lib demo`;
    } catch {
      failed = true;
    }
    if (!failed) {
      console.error("expected missing language scaffold to fail gracefully");
      process.exit(2);
    }
  });
});

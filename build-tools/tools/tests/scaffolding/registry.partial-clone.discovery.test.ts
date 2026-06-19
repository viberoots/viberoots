#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";
import { viberootsTool } from "./lib/viberoots-tools";

// Partial-clone friendly: presence of files enables language; absence hides it

test("scaffolding registry: discovery only lists present languages and allows others to work", async () => {
  process.env.TEST_PARTIAL_CLONE_GO_ONLY = "1";
  await runInTemp("scaf-partial-clone", async (tmp, $) => {
    // Create a minimal partial checkout that includes only Go
    await fsp.mkdir(path.join(tmp, "viberoots/build-tools/tools/nix/templates"), {
      recursive: true,
    });
    await fsp.mkdir(path.join(tmp, "viberoots/build-tools/tools/scaffolding/templates/go"), {
      recursive: true,
    });
    // Provide at least one template directory so `scaf templates` can list Go
    await fsp.mkdir(path.join(tmp, "viberoots/build-tools/tools/scaffolding/templates/go/lib"), {
      recursive: true,
    });
    await fsp.mkdir(path.join(tmp, "build-tools", "go"), { recursive: true });

    // Required files for Go
    await fsp.writeFile(
      path.join(tmp, "viberoots/build-tools/tools/nix/templates/go.nix"),
      "# stub go template\n",
      "utf8",
    );
    await fsp.writeFile(
      path.join(tmp, "viberoots/build-tools/go/defs.bzl"),
      "# stub go defs\n",
      "utf8",
    );
    await fsp.writeFile(
      path.join(tmp, "viberoots/build-tools/tools/scaffolding/templates/go/.keep"),
      "",
      "utf8",
    );

    // languages list should include 'go' only
    const langs = await $({
      stdio: "pipe",
      env: {
        ...process.env,
        VIBEROOTS_ROOT: tmp,
        VIBEROOTS_SOURCE_ROOT: tmp,
        WORKSPACE_ROOT: tmp,
        BUCK_TEST_SRC: tmp,
      },
    })`node ${viberootsTool("viberoots/build-tools/tools/scaffolding/scaf.ts")} templates --json`;
    const arr = JSON.parse(String(langs.stdout || "[]"));
    const present = Array.from(new Set(arr.map((x: any) => x.language)));
    if (!(present.length === 1 && present[0] === "go")) {
      console.error("expected only 'go' to be listed in templates, got:", present);
      process.exit(2);
    }

    // Attempt to scaffold a missing language (e.g., rust) should exit 0 and print [skip]
    await $({
      stdio: "pipe",
      env: {
        ...process.env,
        VIBEROOTS_ROOT: tmp,
        VIBEROOTS_SOURCE_ROOT: tmp,
        WORKSPACE_ROOT: tmp,
        BUCK_TEST_SRC: tmp,
      },
    })`node ${viberootsTool("viberoots/build-tools/tools/scaffolding/scaf.ts")} new rust lib demo`;
  });
});

#!/usr/bin/env zx-wrapper
import parser from "@typescript-eslint/parser";
import { ESLint } from "eslint";
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { runInTemp } from "../lib/test-helpers";

async function importPluginFromWorkspace() {
  const pluginPath = path.join(
    process.cwd(),
    "build-tools",
    "tools",
    "eslint-plugin-bucknix",
    "index.js",
  );
  const mod = await import(pathToFileURL(pluginPath).href);
  return (mod as any).default || mod;
}

test("bucknix/no-raw-graph-json flags direct reads and allows allowlisted paths", async () => {
  await runInTemp("eslint-rule-check", async (tmp, $) => {
    const plugin = await importPluginFromWorkspace();

    const eslint = new ESLint({
      cwd: tmp,
      overrideConfigFile: null,
      overrideConfig: [
        {
          files: ["**/*.*"],
          languageOptions: { parser: parser as any, sourceType: "module", ecmaVersion: "latest" },
          // Use a unique plugin key here to avoid collisions with any preloaded configs
          plugins: { bucktest: plugin },
          rules: { "bucktest/no-raw-graph-json": "error" },
        },
      ],
    });

    // Case 1: violation outside allowlist
    const violatorPath = path.join(tmp, "scripts", "violates.ts");
    await fs.outputFile(
      violatorPath,
      [
        "import fs from 'fs';",
        "async function run(){",
        "  await fs.readFile('build-tools/tools/buck/graph.json', 'utf8');",
        "}",
        "run();",
        "",
      ].join("\n"),
      "utf8",
    );

    const resBad = await eslint.lintText(await fs.readFile(violatorPath, "utf8"), {
      filePath: violatorPath,
    });
    const hasViolation = resBad.some(
      (r) =>
        r.errorCount > 0 &&
        (r.messages || []).some((m) => m.ruleId === "bucktest/no-raw-graph-json"),
    );
    if (!hasViolation) {
      console.error(
        "expected ESLint to flag no-raw-graph-json for non-allowlisted path",
        JSON.stringify(resBad, null, 2).slice(0, 2000),
      );
      process.exit(2);
    }

    // Case 2: allowed location (exporter path) with only a comment mention should not error
    const allowedPath = path.join(tmp, "build-tools", "tools", "buck", "exporter", "ok.ts");
    await fs.outputFile(
      allowedPath,
      "// build-tools/tools/buck/graph.json\nexport const ok = true;\n",
      "utf8",
    );
    const resOk = await eslint.lintText(await fs.readFile(allowedPath, "utf8"), {
      filePath: allowedPath,
    });
    const hasErrorOk = resOk.some((r) => r.errorCount > 0);
    if (hasErrorOk) {
      console.error(
        "expected ESLINT to allow allowed-path usage in comments",
        JSON.stringify(resOk, null, 2).slice(0, 2000),
      );
      process.exit(2);
    }
  });
});

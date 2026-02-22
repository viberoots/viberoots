#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("ts webapp-static naming contract", async () => {
  await runInTemp("scaf-webapp-static-contract", async (_tmp, _$) => {
    const $ = _$({ stdio: "pipe" });

    const templates = await $`scaf templates ts --json`;
    const rows = JSON.parse(String(templates.stdout || "[]")) as Array<{
      language: string;
      template: string;
    }>;
    const tsTemplates = new Set(
      rows.filter((row) => row.language === "ts").map((row) => row.template),
    );
    if (!tsTemplates.has("webapp-static")) {
      throw new Error("expected scaf templates ts to include webapp-static");
    }
    if (tsTemplates.has("webapp")) {
      throw new Error("did not expect legacy webapp template name");
    }

    const help = await $`scaf help ts webapp-static`;
    const helpText = String(help.stdout || "");
    if (!helpText.includes("scaf new ts webapp-static <name>")) {
      throw new Error("expected help usage to include webapp-static");
    }
    if (!helpText.includes("scaf new ts webapp-static demo-web --yes")) {
      throw new Error("expected help examples to include webapp-static");
    }

    await $`scaf new ts webapp-static demo-web --yes --dry-run`;

    const legacy = await $`scaf new node webapp-static demo-web --yes --dry-run`.nothrow();
    if (legacy.exitCode === 0) {
      throw new Error("expected scaf new node webapp-static to fail");
    }
    const legacyErr = `${legacy.stdout || ""}\n${legacy.stderr || ""}`;
    if (
      !legacyErr.includes("TypeScript templates use 'ts'. Try: scaf new ts webapp-static demo-web")
    ) {
      throw new Error("expected clear cutover error for node/webapp-static");
    }

    const legacyHelp = await $`scaf help node webapp-static`.nothrow();
    if (legacyHelp.exitCode === 0) {
      throw new Error("expected scaf help node webapp-static to fail");
    }
    const legacyHelpErr = `${legacyHelp.stdout || ""}\n${legacyHelp.stderr || ""}`;
    if (!legacyHelpErr.includes("TypeScript templates use 'ts'. Try: scaf help ts webapp-static")) {
      throw new Error("expected clear cutover help error for node/webapp-static");
    }
  });
});

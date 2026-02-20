#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("node webapp-static naming contract", async () => {
  await runInTemp("scaf-webapp-static-contract", async (_tmp, _$) => {
    const $ = _$({ stdio: "pipe" });

    const templates = await $`scaf templates node --json`;
    const rows = JSON.parse(String(templates.stdout || "[]")) as Array<{
      language: string;
      template: string;
    }>;
    const nodeTemplates = new Set(
      rows.filter((row) => row.language === "node").map((row) => row.template),
    );
    if (!nodeTemplates.has("webapp-static")) {
      throw new Error("expected scaf templates node to include webapp-static");
    }
    if (nodeTemplates.has("webapp")) {
      throw new Error("did not expect legacy webapp template name");
    }

    const help = await $`scaf help node webapp-static`;
    const helpText = String(help.stdout || "");
    if (!helpText.includes("scaf new node webapp-static <name>")) {
      throw new Error("expected help usage to include webapp-static");
    }
    if (!helpText.includes("scaf new node webapp-static demo-web --yes")) {
      throw new Error("expected help examples to include webapp-static");
    }

    await $`scaf new node webapp-static demo-web --yes --dry-run`;

    const legacy = await $`scaf new node webapp demo-web --yes --dry-run`.nothrow();
    if (legacy.exitCode === 0) {
      throw new Error("expected scaf new node webapp to fail");
    }
    const legacyErr = `${legacy.stdout || ""}\n${legacy.stderr || ""}`;
    if (!legacyErr.includes("unknown template: node/webapp")) {
      throw new Error("expected clear unknown template error for node/webapp");
    }
  });
});

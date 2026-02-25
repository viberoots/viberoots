#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";
import { CANONICAL_TS_TEMPLATE_IDS } from "../../scaffolding/scaf/templates/taxonomy.ts";

const REPRESENTATIVE_TEMPLATES = ["lib", "cli", "webapp-static"];

test("command surface: TypeScript templates are ts-only", async () => {
  await runInTemp("scaf-ts-only", async (_tmp, _$) => {
    const $ = _$({ stdio: "pipe" });
    for (const template of REPRESENTATIVE_TEMPLATES) {
      const demoName = `demo-${template}`;
      await $`scaf new ts ${template} ${demoName} --yes --dry-run`;

      const tsHelp = await $`scaf help ts ${template}`;
      assert.match(String(tsHelp.stdout || ""), new RegExp(`scaf new ts ${template} <name>`));

      const legacyNew = await $`scaf new node ${template} ${demoName} --yes --dry-run`.nothrow();
      assert.notEqual(legacyNew.exitCode, 0);
      assert.match(
        `${legacyNew.stdout || ""}\n${legacyNew.stderr || ""}`,
        new RegExp(`TypeScript templates use 'ts'\\. Try: scaf new ts ${template} ${demoName}`),
      );

      const legacyHelp = await $`scaf help node ${template}`.nothrow();
      assert.notEqual(legacyHelp.exitCode, 0);
      assert.match(
        `${legacyHelp.stdout || ""}\n${legacyHelp.stderr || ""}`,
        new RegExp(`TypeScript templates use 'ts'\\. Try: scaf help ts ${template}`),
      );
    }
  });
});

test("metadata contract: canonical ts templates have ts language and help fields", async () => {
  for (const id of CANONICAL_TS_TEMPLATE_IDS) {
    const template = id.split("/")[1] || "";
    assert.ok(template.length > 0, `invalid canonical template id: ${id}`);
    const root = path.join("build-tools", "tools", "scaffolding", "templates", "ts", template);
    const metaPath = path.join(root, "meta.json");
    const copierPath = path.join(root, "copier.yaml");

    const meta = JSON.parse(await fsp.readFile(metaPath, "utf8")) as {
      language?: string;
      template?: string;
      help?: { usage?: string; notes?: unknown; examples?: unknown };
    };
    assert.equal(meta.language, "ts", `meta language must be ts for ${id}`);
    assert.equal(meta.template, template, `meta template mismatch for ${id}`);

    const help = meta.help || {};
    assert.equal(typeof help.usage, "string", `help.usage must be string for ${id}`);
    assert.match(String(help.usage), new RegExp(`scaf new ts ${template}`));
    assert.ok(Array.isArray(help.notes) && help.notes.length > 0, `help.notes required for ${id}`);
    assert.ok(
      Array.isArray(help.examples) && help.examples.length > 0,
      `help.examples required for ${id}`,
    );

    const copier = await fsp.readFile(copierPath, "utf8");
    assert.match(copier, /^language:\s*["']?ts["']?\s*$/m, `copier language must be ts for ${id}`);
  }
});

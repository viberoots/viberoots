#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("help new <lang> lists templates for that language", async () => {
  await runInTemp("scaf-help-new-list", async (_tmp, _$) => {
    const pipe$ = _$({ stdio: "pipe" });
    const res = await pipe$`scaf help new go`;
    const out = res.stdout;
    if (!/# Available go templates/.test(out)) {
      console.error("help new <lang> missing header");
      process.exit(2);
    }
    if (!/- lib: /.test(out)) {
      console.error("expected lib template listed for go");
      process.exit(2);
    }
  });
});

test("scaf templates uses grouped scan-friendly output by default", async () => {
  await runInTemp("scaf-templates-format", async (_tmp, _$) => {
    const res = await _$({
      stdio: "pipe",
      env: {
        ...process.env,
        COLUMNS: "80",
      },
    })`scaf templates`;
    const out = String(res.stdout || "");
    assert.doesNotMatch(out, /\t/);
    assert.match(out, /^ts:$/m);
    assert.match(out, /^  webapp-ssr-vite\s+Vite-first SSR webapp/m);
    assert.doesNotMatch(out, /^  vars: /m);
    for (const line of out.split("\n").filter(Boolean)) {
      assert.ok(line.length <= 90, `line exceeded terminal-friendly width: ${line}`);
    }
  });
});

test("scaf templates --details includes wrapped template variables", async () => {
  await runInTemp("scaf-templates-details-format", async (_tmp, _$) => {
    const res = await _$({
      stdio: "pipe",
      env: {
        ...process.env,
        COLUMNS: "80",
      },
    })`scaf templates ts --details`;
    const out = String(res.stdout || "");
    assert.match(out, /^ts:$/m);
    assert.match(out, /^  webapp-ssr-vite\s+Vite-first SSR webapp/m);
    assert.match(out, /^    vars: /m);
    for (const line of out.split("\n").filter(Boolean)) {
      assert.ok(line.length <= 90, `line exceeded terminal-friendly width: ${line}`);
    }
  });
});

test("scaf template help wraps long notes and examples", async () => {
  await runInTemp("scaf-template-help-format", async (_tmp, _$) => {
    const res = await _$({
      stdio: "pipe",
      env: {
        ...process.env,
        COLUMNS: "80",
      },
    })`scaf help ts webapp-ssr-vite`;
    const out = String(res.stdout || "");
    assert.match(out, /^Examples:$/m);
    assert.match(out, /scaf new ts webapp-ssr-vite/);
    for (const line of out.split("\n").filter(Boolean)) {
      assert.ok(line.length <= 90, `line exceeded terminal-friendly width: ${line}`);
    }
  });
});

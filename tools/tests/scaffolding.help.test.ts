#!/usr/bin/env zx-wrapper
import { test } from "node:test";

import { runInTemp } from "./lib/test-helpers";

test("help --json includes variables from copier.yaml", async () => {
  await runInTemp("scaf-help-json", async (_tmp, _$) => {
    const pipe$ = _$({ stdio: "pipe" });
    const res = await pipe$`scaf help go lib --json`;
    const obj = JSON.parse(res.stdout.trim());
    if (!Array.isArray(obj.variables) || !obj.variables.includes("name")) {
      console.error("expected help --json to include variables");
      process.exit(2);
    }
  });
});

test("templates --json includes variables per template", async () => {
  await runInTemp("scaf-templates-json", async (_tmp, _$) => {
    const pipe$ = _$({ stdio: "pipe" });
    const res = await pipe$`scaf templates --json`;
    const arr = JSON.parse(res.stdout.trim());
    if (!Array.isArray(arr) || arr.length === 0) {
      console.error("expected templates array");
      process.exit(2);
    }
    const lib = arr.find((x: any) => x.language === "go" && x.template === "lib");
    if (!lib || !Array.isArray(lib.variables) || !lib.variables.includes("name")) {
      console.error("expected variables for go/lib to include 'name'");
      process.exit(2);
    }
  });
});

test("completions emit scripts with dynamic listings", async () => {
  await runInTemp("scaf-completions", async (_tmp, _$) => {
    const pipe$ = _$({ stdio: "pipe" });
    const b = await pipe$`scaf completions bash`;
    if (!/complete -F _scaf_complete scaf/.test(b.stdout)) {
      console.error("bash completions missing hook");
      process.exit(2);
    }
    const z = await pipe$`scaf completions zsh`;
    if (!/#compdef scaf/.test(z.stdout)) {
      console.error("zsh completions missing compdef");
      process.exit(2);
    }
    const f = await pipe$`scaf completions fish`;
    if (!/complete -c scaf/.test(f.stdout)) {
      console.error("fish completions missing complete lines");
      process.exit(2);
    }
    if (!/templates --json/.test(b.stdout)) {
      console.error("bash completions missing dynamic templates call");
      process.exit(2);
    }
  });
});

test("help new/update/regen/delete shows synopsis", async () => {
  await runInTemp("scaf-help-cmds", async (_tmp, _$) => {
    const pipe$ = _$({ stdio: "pipe" });
    const hn = await pipe$`scaf help new`;
    if (!/Usage: scaf new/.test(hn.stdout)) {
      console.error("help new missing usage");
      process.exit(2);
    }
    const hu = await pipe$`scaf help update`;
    if (!/Usage: scaf update/.test(hu.stdout)) {
      console.error("help update missing usage");
      process.exit(2);
    }
    const hr = await pipe$`scaf help regen`;
    if (!/Usage: scaf regen/.test(hr.stdout)) {
      console.error("help regen missing usage");
      process.exit(2);
    }
    const hd = await pipe$`scaf help delete`;
    if (!/Usage: scaf delete/.test(hd.stdout)) {
      console.error("help delete missing usage");
      process.exit(2);
    }
  });
});

test("help new <lang> <template> shows variables preview", async () => {
  await runInTemp("scaf-help-new-vars", async (_tmp, _$) => {
    const pipe$ = _$({ stdio: "pipe" });
    const res = await pipe$`scaf help new go lib`;
    const out = res.stdout;
    if (!/Usage: scaf new/.test(out)) {
      console.error("help new <lang> <tmpl> missing usage");
      process.exit(2);
    }
    if (!/Variables:\n/.test(out) && !/Variables:/.test(out)) {
      console.error("help new <lang> <tmpl> missing variables header");
      process.exit(2);
    }
    if (!/- name/.test(out)) {
      console.error("expected 'name' in variables list");
      process.exit(2);
    }
  });
});

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

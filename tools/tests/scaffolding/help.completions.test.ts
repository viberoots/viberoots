#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

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

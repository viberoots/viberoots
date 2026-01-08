#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { runInTemp } from "./test-helpers";

process.env.TEST_KEEP_TMP = "1";

await runInTemp("buck-cleanup-nondisruptive-child", async (tmp, $) => {
  console.log(`TMP ${tmp}`);
  await $`buck2 build //:flake.lock`;
  console.log("READY");

  const signal = path.join(tmp, "go.signal");
  while (true) {
    try {
      await fsp.access(signal);
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  // If cleanup from other runs is too broad, this build can fail (repo broken / daemon killed mid-flight).
  await $`buck2 build //:flake.lock`;
  console.log("PING_OK");

  await new Promise(() => {});
});

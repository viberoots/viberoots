#!/usr/bin/env zx-wrapper
import { runScafCli } from "./scaf/main.ts";

runScafCli().catch((e) => {
  console.error(e);
  process.exit(1);
});

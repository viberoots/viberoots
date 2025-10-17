#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import { $ } from "zx";

test("cli --help exits 0", async () => {
  await $`node bin/demo-node --help`;
});

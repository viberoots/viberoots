#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import { createFreshCloneFixture } from "./fresh-clone-post-clone.fixture";
import { assertStalePnpmPostCloneCase } from "./fresh-clone-post-clone-stale-cases";

test("post-clone preserves a genuinely stale pnpm importer", async (t) => {
  await assertStalePnpmPostCloneCase(await createFreshCloneFixture(t));
});

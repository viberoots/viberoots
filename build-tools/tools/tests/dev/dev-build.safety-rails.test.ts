#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { shouldPreflightDevBuildStoreSpace } from "../../dev/dev-build/safety-rails.ts";

test("dev-build store-space preflight only applies to broad builds", () => {
  assert.equal(shouldPreflightDevBuildStoreSpace({ subcmd: "build", restArgs: ["//..."] }), true);
  assert.equal(
    shouldPreflightDevBuildStoreSpace({ subcmd: "build", restArgs: ["//foo:bar"] }),
    false,
  );
  assert.equal(shouldPreflightDevBuildStoreSpace({ subcmd: "test", restArgs: ["//..."] }), false);
});

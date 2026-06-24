#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { stripToolMetadataDiffs } from "../../patch/diff";

test("patch diff ignores tool-owned macOS metadata marker hunks", () => {
  const diff = [
    "diff --git a/.metadata_never_index b/.metadata_never_index",
    "new file mode 100644",
    "index 0000000..e69de29",
    "--- /dev/null",
    "+++ b/.metadata_never_index",
    "diff --git a/src/main.go b/src/main.go",
    "index 1111111..2222222 100644",
    "--- a/src/main.go",
    "+++ b/src/main.go",
    "@@ -1 +1 @@",
    "-old",
    "+new",
    "",
  ].join("\n");

  const stripped = stripToolMetadataDiffs(diff);
  assert.doesNotMatch(stripped, /\.metadata_never_index/);
  assert.match(stripped, /diff --git a\/src\/main\.go b\/src\/main\.go/);
  assert.match(stripped, /\+new/);
});

test("patch diff returns empty when only tool-owned macOS metadata changed", () => {
  const diff = [
    "diff --git a/.metadata_never_index b/.metadata_never_index",
    "new file mode 100644",
    "index 0000000..e69de29",
    "--- /dev/null",
    "+++ b/.metadata_never_index",
    "",
  ].join("\n");

  assert.equal(stripToolMetadataDiffs(diff), "");
});

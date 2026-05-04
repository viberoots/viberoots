#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { attachGoModuleLabels } from "../../buck/exporter/labeler";
import type { Batch, Node } from "../../buck/exporter/types";

test("go labeler throws if go list results are not provided for labeling", async () => {
  const n: Node = {
    name: "//m:lib",
    rule_type: "go_library",
    labels: ["lang:go"],
    srcs: ["m/lib.go"],
  };

  const b: Batch = {
    tuple: {
      goos: "linux",
      goarch: "amd64",
      cgo: "0",
      tagsKey: "",
      goflagsKey: "",
      toolchain: "x",
    },
    members: [n],
    roots: ["m"],
    cwd: "m",
  };

  await assert.rejects(
    () => attachGoModuleLabels([n], [b], undefined as any),
    /missing go list results map/i,
  );
});

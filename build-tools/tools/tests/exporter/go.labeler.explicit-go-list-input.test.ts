#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { attachGoModuleLabels } from "../../buck/exporter/labeler";
import type { Batch, GoListByBatch, GoPkg, Node } from "../../buck/exporter/types";

test("go labeler derives module:* labels from explicit go list results (no global cache)", async () => {
  (globalThis as any).__GO_LIST_CACHE = {
    get() {
      throw new Error("unexpected global cache access");
    },
  };

  const n: Node = {
    name: "//m:lib_test",
    rule_type: "go_test",
    labels: ["lang:go"],
    srcs: ["m/lib_test.go"],
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

  const pkgs: GoPkg[] = [
    {
      ImportPath: "example.com/m",
      Dir: path.resolve(process.cwd(), "m"),
      Deps: ["github.com/stretchr/testify/require"],
      Module: { Path: "example.com/m", Version: "v0.0.0-20250101000000-000000000000" },
    },
    {
      ImportPath: "github.com/stretchr/testify/require",
      Dir: "/private/var/tmp/pkg", // irrelevant for module labeling; tests path normalization indirectly
      Deps: [],
      Module: { Path: "github.com/stretchr/testify", Version: "v1.9.0" },
    },
  ];

  const goListByBatch: GoListByBatch = new Map<Batch, GoPkg[]>([[b, pkgs]]);
  const out = await attachGoModuleLabels([n], [b], goListByBatch);

  const got = out[0]?.labels?.filter((l) => l.startsWith("module:")) || [];
  got.sort();

  assert.deepEqual(got, [
    "module:example.com/m@v0.0.0-20250101000000-000000000000",
    "module:github.com/stretchr/testify@v1.9.0",
  ]);
});

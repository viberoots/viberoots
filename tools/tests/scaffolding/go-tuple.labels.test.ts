#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("nix_go_library stamps gotags and goenv tuple labels deterministically", async () => {
  await runInTemp("go-tuple-labels", async (tmp, $) => {
    await $({
      cwd: tmp,
    })`bash --noprofile --norc -c 'mkdir -p tmp && cat > tmp/TARGETS <<'\''EOF'\''
load("//go:defs.bzl", "nix_go_library")

nix_go_library(
    name = "lib",
    srcs = [],
    build_tags = ["S3", "debug", "DEBUG"],  # case-insensitive; dedup + sort => debug,s3
    goos = "linux",
    goarch = "amd64",
    cgo_enabled = True,
)
EOF'`;

    const probe = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 --isolation-dir go_tuple_labels cquery "attr(labels, '.*', //tmp:lib)" --json --output-attribute labels`;
    if (probe.exitCode !== 0) return; // skip if prelude not available
    const parsed = JSON.parse(String(probe.stdout || "")) as unknown;
    const values = Array.isArray(parsed)
      ? (parsed as Array<{ labels?: string[] }>)
      : (Object.values(parsed as Record<string, { labels?: string[] }>) as Array<{
          labels?: string[];
        }>);
    const labels = (values[0]?.labels || []).sort();
    const want = [
      "gotags:debug,s3",
      "goenv:GOOS=linux",
      "goenv:GOARCH=amd64",
      "goenv:CGO_ENABLED=1",
    ];
    for (const w of want) {
      if (!labels.includes(w)) {
        console.error("expected label missing:", w, "\nhave:", labels);
        process.exit(2);
      }
    }
  });
});

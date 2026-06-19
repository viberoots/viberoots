#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import { buckCommandEnv, isBuckDaemonInitTransient } from "../../lib/buck-command-env";
import { inheritedBuckIsolation, runInTemp } from "../lib/test-helpers";

test("nix_go_library stamps gotags and goenv tuple labels deterministically", async () => {
  await runInTemp("go-tuple-labels", async (tmp, $) => {
    await $({
      cwd: tmp,
    })`bash --noprofile --norc -c 'mkdir -p tmp && cat > tmp/TARGETS <<'\''EOF'\''
load("@viberoots//build-tools/go:defs.bzl", "nix_go_library")

nix_go_library(
    name = "lib",
    srcs = [],
    build_tags = ["S3", "debug", "DEBUG"],  # case-insensitive; dedup + sort => debug,s3
    goos = "linux",
    goarch = "amd64",
    cgo_enabled = True,
)
EOF'`;

    const runProbe = async () =>
      await $({
        cwd: tmp,
        stdio: "pipe",
        reject: false,
        nothrow: true,
        env: buckCommandEnv(),
      })`buck2 --isolation-dir ${inheritedBuckIsolation("go_tuple_labels")} cquery --target-platforms //:no_cgo --json --output-attribute labels //tmp:lib`;
    let probe = await runProbe();
    if (probe.exitCode !== 0) {
      const msg = String(probe.stderr || probe.stdout || "");
      if (isBuckDaemonInitTransient(msg)) {
        await new Promise<void>((resolve) => setTimeout(resolve, 150));
        probe = await runProbe();
      }
    }
    if (probe.exitCode !== 0) {
      console.error(String(probe.stderr || probe.stdout || ""));
      process.exit(2);
    }
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

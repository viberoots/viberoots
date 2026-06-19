#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

function extractString(v: unknown): string | undefined {
  if (typeof v === "string") return v;
  if (v && typeof v === "object" && "value" in v && typeof (v as any).value === "string") {
    return (v as any).value as string;
  }
  return undefined;
}

test("nix_node_test derives importer deterministically from lockfile label", async () => {
  await runInTemp("node-nix-test-importer-derived", async (tmp, $) => {
    const dir = path.join(tmp, "projects", "apps", "web");
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(path.join(dir, "pnpm-lock.yaml"), "lockfileVersion: 9\n", "utf8");

    await fsp.writeFile(
      path.join(dir, "TARGETS"),
      [
        'load("@viberoots//build-tools/node:defs.bzl", "nix_node_test")',
        "",
        "nix_node_test(",
        '  name = "t",',
        "  patterns = [],",
        '  lockfile_label = "lockfile:././projects/apps/web/pnpm-lock.yaml#projects/apps/web",',
        ")",
        "",
      ].join("\n"),
      "utf8",
    );

    const probe = await $({
      cwd: tmp,
      stdio: "pipe",
      reject: false,
      nothrow: true,
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute importer //projects/apps/web:t`;
    assert.equal(probe.exitCode, 0, "expected buck2 cquery to succeed");

    const parsed = JSON.parse(String(probe.stdout || "")) as unknown;
    if (Array.isArray(parsed)) {
      const raw = (parsed[0] as { importer?: unknown } | undefined)?.importer;
      assert.equal(
        extractString(raw),
        "projects/apps/web",
        `unexpected cquery output: ${probe.stdout}`,
      );
      return;
    }

    if (parsed && typeof parsed === "object") {
      const first = Object.values(parsed as Record<string, { importer?: unknown }>)[0];
      assert.equal(
        extractString(first?.importer),
        "projects/apps/web",
        `unexpected cquery output: ${probe.stdout}`,
      );
      return;
    }

    assert.fail(`unexpected buck2 cquery JSON shape: ${probe.stdout}`);
  });
});

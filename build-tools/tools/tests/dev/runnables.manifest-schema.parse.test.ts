#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseRunnableManifest } from "../../lib/runnables.ts";

test("parseRunnableManifest keeps backward compatibility for bins-only entries", () => {
  const legacy = JSON.stringify([
    { label: "//projects/apps/demo:demo", kind: "bin", bins: ["/nix/store/x/bin/demo"], aux: [] },
  ]);
  const parsed = parseRunnableManifest(legacy);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0]?.label, "//projects/apps/demo:demo");
  assert.equal(parsed[0]?.runnable?.run.prod.argv[0], "/nix/store/x/bin/demo");
});

test("parseRunnableManifest reads explicit runnable contract fields", () => {
  const withRunnable = JSON.stringify([
    {
      label: "//projects/apps/web:web",
      kind: "app",
      bins: [],
      aux: [],
      runnable: {
        kind: "webapp",
        run: {
          prod: { argv: ["python3", "-m", "http.server", "--directory", "/nix/store/x/dist"] },
          dev: { argv: ["pnpm", "--dir", "projects/apps/web", "dev"] },
        },
      },
    },
  ]);
  const parsed = parseRunnableManifest(withRunnable);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0]?.runnable?.kind, "webapp");
  assert.deepEqual(parsed[0]?.runnable?.run.dev?.argv, [
    "pnpm",
    "--dir",
    "projects/apps/web",
    "dev",
  ]);
});

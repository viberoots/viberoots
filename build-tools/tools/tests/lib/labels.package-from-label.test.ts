#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import { packagePathFromLabel } from "../../lib/labels";

test("packagePathFromLabel extracts package from normalized labels", async () => {
  const cases: Array<{ in: string; out: string }> = [
    { in: "root//projects/apps/foo:svc (config//buck:cfg)", out: "projects/apps/foo" },
    { in: "//projects/libs/demo:lib", out: "projects/libs/demo" },
    { in: "prelude//build-tools/cpp:lib", out: "build-tools/cpp" },
  ];
  for (const c of cases) {
    const got = packagePathFromLabel(c.in);
    if (got !== c.out) {
      console.error("packagePathFromLabel mismatch:", { in: c.in, got, want: c.out });
      process.exit(2);
    }
  }
});

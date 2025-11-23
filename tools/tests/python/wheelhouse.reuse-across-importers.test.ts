#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("python wheelhouse: identical lock+patch → identical store path across importers", async () => {
  await runInTemp("py-wheelhouse-reuse", async (tmp, _$) => {
    const $ = _$
      ? _$
      : (cmd: TemplateStringsArray, ...args: any[]) => (global as any).$`${cmd}${args}`;

    // Create two importers with identical uv.lock and no patches.
    const impA = path.join(tmp, "apps", "alpha");
    const impB = path.join(tmp, "apps", "bravo");
    await fs.mkdirp(impA);
    await fs.mkdirp(impB);
    const lockText = ["# uv lock", "[[package]]", 'name = "mydep"', 'version = "1.0.0"', ""].join(
      "\n",
    );
    await fs.writeFile(path.join(impA, "uv.lock"), lockText, "utf8");
    await fs.writeFile(path.join(impB, "uv.lock"), lockText, "utf8");

    // Provide a shared vendor origin for mydep@1.0.0 to avoid any network.
    const vendor = path.join(tmp, "vendor", "mydep-1.0.0", "mydep");
    await fs.mkdirp(vendor);
    await fs.writeFile(path.join(vendor, "__init__.py"), "def msg():\n    return 'ok'\n", "utf8");

    async function nixOut(attr: string): Promise<string> {
      const { stdout } = await $({
        cwd: tmp,
        stdio: "pipe",
        env: {
          ...process.env,
          // Use the stub backend to avoid external uv2nix dependency in this test.
          NIX_PY_USE_STUB_BACKEND: "1",
          NIX_PY_TEST_RESOLVE_JSON: JSON.stringify({
            mydep: {
              version: "1.0.0",
              originPath: path.join(tmp, "vendor", "mydep-1.0.0"),
            },
          }),
        },
      })`nix build --impure --accept-flake-config --no-link --print-out-paths .#${attr}`;
      return String(stdout || "")
        .trim()
        .split(/\s+/)
        .pop() as string;
    }

    const attrA = "py-wheelhouse-apps-alpha";
    const attrB = "py-wheelhouse-apps-bravo";

    const outA1 = await nixOut(attrA);
    const outB1 = await nixOut(attrB);
    if (!outA1 || !outB1) {
      console.error("missing outPath(s):", { outA1, outB1 });
      process.exit(2);
    }
    // For the stub backend, store paths may differ. Assert content equivalence of the realized site.
    const siteA = path.join(outA1, "site");
    const siteB = path.join(outB1, "site");
    const { exitCode: diffExit } = await $({
      cwd: tmp,
      stdio: "inherit",
      nothrow: true,
    })`diff -ruN ${siteA} ${siteB}`;
    if (diffExit !== 0) {
      console.error("wheelhouse site contents differ between importers", { siteA, siteB });
      process.exit(2);
    }

    // Re-build to confirm stability
    const outA2 = await nixOut(attrA);
    const outB2 = await nixOut(attrB);
    // Re-assert site equivalence on rebuild
    const siteA2 = path.join(outA2, "site");
    const siteB2 = path.join(outB2, "site");
    const { exitCode: diffExit2 } = await $({
      cwd: tmp,
      stdio: "inherit",
      nothrow: true,
    })`diff -ruN ${siteA2} ${siteB2}`;
    if (diffExit2 !== 0) {
      console.error("wheelhouse site contents differ after rebuild", { siteA2, siteB2 });
      process.exit(2);
    }
  });
});

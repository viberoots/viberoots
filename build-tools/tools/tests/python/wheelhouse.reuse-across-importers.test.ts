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
    const impA = path.join(tmp, "projects", "apps", "alpha");
    const impB = path.join(tmp, "projects", "apps", "bravo");
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
          NIX_PY_TEST_RESOLVE_JSON: JSON.stringify({
            mydep: {
              version: "1.0.0",
              originPath: path.join(tmp, "vendor", "mydep-1.0.0"),
            },
          }),
        },
      })`nix build --impure --accept-flake-config --no-link --print-out-paths ${`path:${tmp}#${attr}`}`;
      return String(stdout || "")
        .trim()
        .split(/\s+/)
        .pop() as string;
    }

    const attrA = "py-wheelhouse-projects-apps-alpha";
    const attrB = "py-wheelhouse-projects-apps-bravo";

    let outA1: string = "";
    try {
      outA1 = await nixOut(attrA);
    } catch (e) {
      try {
        const { stdout: sys } = await $({
          cwd: tmp,
          stdio: "pipe",
        })`nix eval --raw --impure --accept-flake-config --expr builtins.currentSystem`;
        const sysStr = String(sys || "").trim();
        const { stdout: pkgs } = await $({
          cwd: tmp,
          stdio: "pipe",
        })`nix eval --json --impure --accept-flake-config ${`path:${tmp}#packages.${sysStr}`} | jq -r 'keys[]' | sort`.nothrow();
        console.error("diagnostic: packages.%s keys:\n%s", sysStr, String(pkgs || "").trim());
      } catch {}
      throw e;
    }
    const outB1 = await nixOut(attrB);
    if (!outA1 || !outB1) {
      try {
        // Diagnostic: list available package attrs to help debug missing wheelhouse attr exposure
        const { stdout: pkgs } = await $({
          cwd: tmp,
          stdio: "pipe",
        })`bash --noprofile --norc -c ${`set -euo pipefail
sys="$(nix eval --raw --impure --accept-flake-config --expr builtins.currentSystem)"
nix eval --json --impure --accept-flake-config "path:${tmp}#packages.$sys" | jq -r 'keys[]' | sort
`}`.nothrow();
        console.error("diagnostic: packages.<system> keys:\n", String(pkgs || "").trim());
      } catch {}
      console.error("missing outPath(s):", { outA1, outB1 });
      process.exit(2);
    }
    // Under uv2nix, identical lock+patch must yield identical store paths
    if (outA1 !== outB1) {
      console.error("expected identical wheelhouse store paths", { outA1, outB1 });
      process.exit(2);
    }

    // Re-build to confirm stability
    const outA2 = await nixOut(attrA);
    const outB2 = await nixOut(attrB);
    if (outA1 !== outA2 || outB1 !== outB2) {
      console.error("wheelhouse store paths changed across rebuilds", {
        outA1,
        outA2,
        outB1,
        outB2,
      });
      process.exit(2);
    }
  });
});

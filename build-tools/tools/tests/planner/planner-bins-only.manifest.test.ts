#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import "zx/globals";
import { runInTemp } from "../lib/test-helpers";

void (async function main() {
  console.log("TAP version 13");
  const ok = await runInTemp("planner-bins-only", async (tmp, $) => {
    const expr = `
      let
        pkgs = import <nixpkgs> {};
        lib = pkgs.lib;
        mkBin = pkgs.runCommand "planner-bin" {} ''
          mkdir -p "$out/bin"
          cat > "$out/bin/demo-cli" <<'EOF'
#!/usr/bin/env bash
echo demo
EOF
          chmod +x "$out/bin/demo-cli"
        '';
        mkLib = pkgs.runCommand "planner-lib" {} ''
          mkdir -p "$out/lib"
          echo "ok" > "$out/lib/lib.txt"
        '';
        M = import ./viberoots/build-tools/tools/nix/planner/manifest.nix {
          inherit pkgs lib;
          repoRootStr = builtins.toString ./.;
          devOverrideJSON = "";
          devOverrideCppJSON = "";
          devOverridePyJSON = "";
          isCI = false;
          suppressDevOverrideLog = true;
          overridePresentList = [];
          goOutPaths = {
            "//projects/apps/demo-cli:demo-cli" = mkBin;
            "//projects/libs/demo-lib:demo-lib" = mkLib;
          };
          cppOutPaths = {};
          nodeOutPaths = {};
          rustOutPaths = {
            "//projects/apps/rust-cli:rust-cli" = mkBin;
          };
          nodeDevImporters = {};
          modulesTomlFor = _: ./gomod2nix.toml;
          pkgPathOf = _: ".";
          targetNameOf = _: "demo";
          sanitize = s: "t";
        };
      in M.all
    `;
    const { stdout } = await $({
      cwd: tmp,
      stdio: "pipe",
    })`nix build --impure --expr ${expr} --no-link --print-out-paths`;
    const outPath =
      String(stdout || "")
        .trim()
        .split("\n")
        .filter(Boolean)
        .pop() || "";
    const manifestPath = path.join(outPath, "manifest.json");
    const txt = await fsp.readFile(manifestPath, "utf8");
    const arr = JSON.parse(txt) as Array<any>;
    // Assert only binaries are present (label ends with demo-cli target, not lib)
    const labels = arr.map((e) => String(e?.label || ""));
    const hasCli = labels.some((l) => /projects\/apps\/demo-cli:demo-cli/.test(l));
    const hasRustCli = labels.some((l) => /projects\/apps\/rust-cli:rust-cli/.test(l));
    const hasLib = labels.some((l) => /projects\/libs\/demo-lib:demo-lib/.test(l));
    if (!hasCli || !hasRustCli || hasLib) {
      console.log("not ok 1 - manifest should contain only Go and Rust binaries (library absent)");
      console.log(`  ---\n  labels: ${JSON.stringify(labels)}\n  ...`);
      return false;
    }
    const goEntry = arr.find((entry) => entry.label === "//projects/apps/demo-cli:demo-cli");
    const rustEntry = arr.find((entry) => entry.label === "//projects/apps/rust-cli:rust-cli");
    if (goEntry?.runnable?.kind !== "native-bin" || rustEntry?.runnable?.kind !== "native-bin") {
      console.log(
        "not ok 1 - existing Go and new Rust runnable entries must retain native-bin semantics",
      );
      return false;
    }
    console.log("ok 1 - manifest contains only binaries and preserves existing Go semantics");
    return true;
  });
  console.log("1..1");
  if (!ok) process.exit(1);
})();

export const registry = "registry+https://github.com/rust-lang/crates.io-index";
export const version = "1.0.15";
export const checksum = "4a5f13b858c8d314ee3e8f639011f7ccefe71f97f96e50151fb991f267928e2c";

export function rustLeafPatchText(condition: string): string {
  return [
    "diff --git a/src/lib.rs b/src/lib.rs",
    "--- a/src/lib.rs",
    "+++ b/src/lib.rs",
    "@@ -102,5 +102,6 @@ impl Buffer {",
    "         if string.len() > I::MAX_STR_LEN {",
    "             unsafe { hint::unreachable_unchecked() };",
    "         }",
    `+        if string == "${condition}" { return "2"; }`,
    "         string",
    "     }",
    "",
  ].join("\n");
}

export function nativePatchText(
  extension: "c" | "cpp",
  supportValue: number,
  offsetValue: number,
): string {
  return [
    `diff --git a/src/support.${extension} b/src/support.${extension}`,
    `--- a/src/support.${extension}`,
    `+++ b/src/support.${extension}`,
    "@@ -1,2 +1,2 @@",
    ' #include "../include/support.h"',
    "-int support_value(void) { return 38; }",
    `+int support_value(void) { return ${supportValue}; }`,
    "diff --git a/include/offset.h b/include/offset.h",
    "--- a/include/offset.h",
    "+++ b/include/offset.h",
    "@@ -1 +1 @@",
    "-#define NATIVE_OFFSET 0",
    `+#define NATIVE_OFFSET ${offsetValue}`,
    "",
  ].join("\n");
}

export async function assertResolvedNativeInputs(
  $: typeof import("zx").$,
  tmp: string,
  generator: string,
  graph: string,
): Promise<void> {
  const expression = `
    let planned = import ${JSON.stringify(generator)} {
      pkgs = import <nixpkgs> {};
      src = ./.;
      graphJsonPath = ${JSON.stringify(graph)};
    }; in planned.selected.passthru.viberootsRust.native_link_inputs
  `;
  const result = await $({
    cwd: tmp,
    env: { ...process.env, BUCK_TARGET: "//projects/libs/interop_bridge:bridge" },
    stdio: "pipe",
  })`nix eval --impure --json --expr ${expression}`;
  const inputs = JSON.parse(String(result.stdout)) as string[];
  assert.equal(inputs.length, 2);
  assert.equal(new Set(inputs).size, 2);
  assert.match(inputs[0]!, /interop_native-native/);
  assert.match(inputs[1]!, /interop_native-support/);
}
import assert from "node:assert/strict";

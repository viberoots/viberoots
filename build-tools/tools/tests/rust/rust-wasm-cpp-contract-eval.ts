import path from "node:path";

const sourceRoot = path.resolve(path.basename(process.cwd()) === "viberoots" ? "." : "viberoots");
const contract = path.join(sourceRoot, "build-tools/tools/nix/planner/cpp-wasm-contract.nix");

export function wasmStaticProducer(
  language: "cpp" | "go" | "rust",
  changes: Record<string, unknown> = {},
) {
  return {
    name: "//projects/libs/producer:static",
    labels: [`lang:${language}`, "kind:wasm", "wasm:static"],
    wasm_abi: "bare",
    wasm_target: "wasm32-unknown-unknown",
    wasm_allocator: language === "rust" ? "rust" : language === "go" ? "tinygo" : "none",
    wasm_libc: "none",
    wasm_exception_policy: "trap",
    wasm_runtime: "link-only",
    link_deps: [],
    ...changes,
  };
}

export async function evaluateCppWasmContract(
  producer: Record<string, unknown>,
  consumerChanges: Record<string, unknown> = {},
) {
  const consumer = {
    name: "//projects/libs/cpp:consumer",
    labels: ["lang:cpp", "kind:wasm", "wasm:static"],
    wasm_abi: "bare",
    wasm_target: "wasm32-unknown-unknown",
    wasm_allocator: "none",
    wasm_libc: "none",
    wasm_exception_policy: "trap",
    wasm_runtime: "link-only",
    link_deps: ["//projects/libs/producer:static"],
    ...consumerChanges,
  };
  const expression = `
    let
      lib = (import <nixpkgs> {}).lib;
      nodes = builtins.fromJSON ${JSON.stringify(JSON.stringify([consumer, producer]))};
      byName = builtins.listToAttrs (map (node: { name = node.name; value = node; }) nodes);
      contract = import ${JSON.stringify(contract)} {
        inherit lib byName;
        get = node: field: node.\${field} or null;
        labelsOf = node: node.labels or [];
      };
    in contract.validateDirectDependencies "//projects/libs/cpp:consumer"
  `;
  return await $({ stdio: "pipe" })`nix eval --impure --json --expr ${expression}`.nothrow();
}

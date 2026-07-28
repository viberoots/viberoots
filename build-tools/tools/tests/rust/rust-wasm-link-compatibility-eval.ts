import path from "node:path";
import { wasmStaticProducer } from "./rust-wasm-cpp-contract-eval";

const sourceRoot = path.resolve(path.basename(process.cwd()) === "viberoots" ? "." : "viberoots");
const planner = path.join(sourceRoot, "build-tools/tools/nix/planner/rust-wasm.nix");
const goPlanner = path.join(sourceRoot, "build-tools/tools/nix/planner/go-wasm.nix");

export async function evaluate(
  producer: Record<string, unknown>,
  consumerChanges: Record<string, unknown> = {},
) {
  const consumer = {
    name: "//projects/apps/rust:app",
    labels: ["lang:rust", "kind:wasm", "wasm:module"],
    wasm_abi: "bare",
    wasm_target: "wasm32-unknown-unknown",
    wasm_link_kind: "module",
    wasm_allocator: "rust",
    wasm_libc: "none",
    wasm_exception_policy: "trap",
    wasm_runtime: "webassembly",
    link_deps: ["//projects/libs/producer:static"],
    link_closure: "direct",
    ...consumerChanges,
  };
  const expression = `
    let
      lib = (import <nixpkgs> {}).lib;
      nodes = builtins.fromJSON ${JSON.stringify(JSON.stringify([consumer, producer]))};
      byName = builtins.listToAttrs (map (node: { name = node.name; value = node; }) nodes);
      get = node: field: node.\${field} or null;
      P = {
        cleanLabel = value: value;
        nameOf = node: node.name;
        labelsOf = node: node.labels or [];
      };
      ctx = {
        inherit nodes get;
        dependencyArtifactOf = label: "/nix/store/artifact-" + builtins.baseNameOf label;
      };
      wasm = import ${JSON.stringify(planner)} {
        inherit lib P ctx;
        nodeFor = label: byName.\${label};
        normalizeList = _: value: if value == null then [] else value;
      };
    in wasm.inputsFor "//projects/apps/rust:app" "wasm"
  `;
  return await $({ stdio: "pipe" })`nix eval --impure --json --expr ${expression}`.nothrow();
}

export async function evaluateTinyGo(
  producer: Record<string, unknown>,
  consumerChanges: Record<string, unknown> = {},
  wasmBackend = "wasm",
) {
  const consumer = {
    name: "//projects/apps/go:app",
    labels: ["lang:go", "kind:wasm"],
    link_deps: ["//projects/libs/producer:static"],
    link_closure: "direct",
    ...consumerChanges,
  };
  const expression = `
    let
      lib = (import <nixpkgs> {}).lib;
      nodes = builtins.fromJSON ${JSON.stringify(JSON.stringify([consumer, producer]))};
      byName = builtins.listToAttrs (map (node: { name = node.name; value = node; }) nodes);
      get = node: field: node.\${field} or null;
      labelsOfName = name: byName.\${name}.labels or [];
      nodeOfName = name: byName.\${name};
      wasm = (import ${JSON.stringify(goPlanner)} { inherit lib; }) {
        T = {
          cppHeaders = args: args;
          cppWasmStaticLib = args: args;
          goTinyWasmLib = args: args;
        };
        inherit get byName labelsOfName nodeOfName;
        repoRoot = /.;
        pkgPathOf = _: ".";
        L = { srcsOf = _: []; };
        LC = import ${JSON.stringify(path.join(sourceRoot, "build-tools/tools/nix/planner/link-closure.nix"))} { inherit lib; };
        normalizeLabelList = _: value: if value == null then [] else value;
        normalizeOverrides = _: value: if value == null then {} else value;
        dedupePreserveOrder = values: lib.unique values;
        dependencyArtifactOf = label: "/nix/store/artifact-" + builtins.baseNameOf label;
        wasmBackend = ${JSON.stringify(wasmBackend)};
      };
    in wasm.mkTinyWasm "//projects/apps/go:app"
  `;
  return await $({ stdio: "pipe" })`nix eval --impure --json --expr ${expression}`.nothrow();
}

export function wasiProducer(language: "cpp" | "go" | "rust", target: string, allocator: string) {
  return wasmStaticProducer(language, {
    labels: [`lang:${language}`, "kind:wasm", "wasm:static", "wasm:wasi"],
    wasm_abi: "wasi",
    wasm_target: target,
    wasm_link_kind: "static",
    wasm_allocator: allocator,
    wasm_libc: "wasi-libc",
  });
}

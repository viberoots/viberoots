#!/usr/bin/env zx-wrapper
export interface Node {
  name: string;
  rule_type: string;
  labels?: string[];
  srcs?: string[];
  cmd?: string;
  out?: string;
  cargo_manifest?: string;
  cargo_lock?: string;
  cargo_root?: string;
  cargo_package?: string;
  cargo_lock_identity?: string;
  cargo_output_hashes?: Record<string, string>;
  cargo_fixed_sources?: Record<string, string>;
  crate?: string;
  public_crate?: string;
  crate_type?: string;
  host_role?: "host" | "target";
  generated_outputs?: string[];
  binding_config?: string;
  interop_kind?: "c" | "cxx";
  interop_generator?: string;
  panic_strategy?: string;
  exception_policy?: string;
  allocator?: string;
  thread_safety?: string;
  cxx_standard?: string;
  c_standard?: string;
  compiler_family?: string;
  compiler_identity?: string;
  stl?: string;
  module_surface?: string;
  wasm_abi?: "bare" | "wasi";
  wasm_abi_explicit?: boolean;
  wasm_target?: string;
  wasm_link_kind?: "module" | "static" | "browser" | "component";
  wasm_allocator?: string;
  wasm_libc?: string;
  wasm_exception_policy?: string;
  wasm_runtime?: string;
  wasm_header?: string;
  exported_functions?: string[];
  wasm_optimize?: "none" | "speed" | "size";
  wasm_debug?: boolean;
  wasm_source_map?: boolean;
  wit?: string;
  wit_world?: string;
  component_adapter?: string;
  language_standard?: string;
  target_triple?: string;
  features?: string[];
  default_features?: boolean;
  behavior_probe?: boolean;
  profile?: string;
  target?: string;
  local_patch_dirs?: string[];
  module?: string;
  build_py_deps?: string[];
  runtime_deps?: string[];
  frontend_dist?: string;
  sidecar_deps?: string[];
  sidecar_destinations?: string[];
  tauri_config?: string;
  tauri_platform?: string;
  tauri_root?: string;
  resources?: string[];
  resource_sources?: string[];
  resource_destinations?: string[];
  capabilities?: string[];
  permissions?: string[];
  app_commands?: string[];
  app_windows?: string[];
  icons?: string[];
  addon_name?: string;
  node_api_version?: number;
  platform?: string;
  python_abi?: string;
}

export interface Tuple {
  goos: string;
  goarch: string;
  cgo: string;
  tagsKey: string;
  goflagsKey: string;
  toolchain: string;
}

export interface GoPkg {
  ImportPath?: string;
  Dir?: string;
  Deps?: string[];
  Imports?: string[];
  ForTest?: string | null;
  Module?: {
    Path?: string;
    Version?: string;
    Replace?: { Path?: string; Version?: string } | null;
  } | null;
}

export type GoListByBatch = Map<Batch, GoPkg[]>;

export interface Batch {
  tuple: Tuple;
  members: Node[];
  roots: string[];
  cwd: string;
}

export interface Metrics {
  totalBatches: number;
  cacheHits: number;
  cacheMisses: number;
  durationMs: number;
  tupleKeys: string[];
}

export interface Adapter {
  name: string;
  isNode(n: Node): boolean;
  buildBatches(nodes: Node[]): Promise<Batch[]>;
  attachLabels(
    nodes: Node[],
    batches: Batch[],
    cacheDir: string,
    goListByBatch?: GoListByBatch,
  ): Promise<Node[]>;
  // Optional adapter-specific validation hook:
  // Return a list of human-readable findings (strings). The main driver applies
  // severity handling (warn vs error) and CI overrides. Adapters MUST NOT throw.
  validate?(nodes: Node[]): Promise<string[]> | string[];
}

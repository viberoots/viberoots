{ lib }:
path:
let
  root = builtins.toString path;
  rootWithSlash = root + "/";
  goOnly = builtins.getEnv "TEST_PARTIAL_CLONE_GO_ONLY" == "1";
  excludeCppReqs = builtins.getEnv "TEST_EXCLUDE_CPP_REQS" == "1";
  rootsEnv = lib.trim (builtins.getEnv "TEST_RSYNC_ROOTS");
  rootsRaw =
    if rootsEnv == "" then []
    else builtins.split "[,[:space:]]+" rootsEnv;
  roots = lib.filter (r: r != "") (map (r: lib.removePrefix "/" r) rootsRaw);
  rootDirs = [
    ".husky"
    "build-tools"
    "cpp"
    "go"
    "lang"
    "node"
    "patches"
    "python"
    "tools"
    "third_party"
    "toolchains"
    "types"
  ];
  rootMdKeep = [
    "abstractions.md"
  ];
  isRootFile = rel: !(lib.hasInfix "/" rel) && rel != "";
  isExcludedRootFile = base:
    base == ".envrc" ||
    base == ".git" ||
    base == ".buck" ||
    base == ".buck2_shim" ||
    base == ".cache" ||
    base == ".direnv" ||
    base == ".pnpm-store" ||
    base == "buck-out" ||
    base == "node_modules" ||
    base == "coverage" ||
    base == ".clinic" ||
    base == "result" ||
    base == "test-logs" ||
    base == "collect-garbage-log.txt" ||
    base == ".patch-sessions.json.tmp" ||
    (lib.hasPrefix "quad-alignment-" base && lib.hasSuffix ".md" base) ||
    (lib.hasPrefix "trio-alignment-" base && lib.hasSuffix ".md" base) ||
    (lib.hasSuffix ".md" base && !(lib.elem base rootMdKeep)) ||
    (lib.hasPrefix "devbuild.run." base && lib.hasSuffix ".out" base) ||
    (lib.hasPrefix "run." base && lib.hasSuffix ".out" base) ||
    (lib.hasPrefix "v." base && lib.hasSuffix ".out" base);
  isExcludedPath = rel:
    rel == "build-tools/tools/buck/graph.json" ||
    rel == "third_party/providers/nix_attr_map.bzl" ||
    (lib.hasPrefix "third_party/providers/TARGETS" rel && lib.hasSuffix ".auto" rel) ||
    (lib.hasSuffix ".patch-sessions.json.tmp" rel) ||
    (goOnly && (lib.hasPrefix "cpp/" rel || rel == "cpp")) ||
    (goOnly && lib.hasPrefix "build-tools/tools/nix/templates" rel) ||
    (goOnly && lib.hasPrefix "build-tools/tools/scaffolding/templates" rel) ||
    (excludeCppReqs && (rel == "build-tools/cpp/defs.bzl" || rel == "build-tools/cpp/wasm_defs.bzl")) ||
    (excludeCppReqs && rel == "build-tools/tools/nix/templates/cpp.nix");
  allowByRoots = rel:
    rel == "flake.nix" ||
    rel == "flake.lock" ||
    builtins.any (r: rel == r || lib.hasPrefix (r + "/") rel) roots;
  allowByDefault = rel:
    let
      base = builtins.baseNameOf rel;
      top = lib.head (lib.splitString "/" rel);
    in
      (isRootFile rel && !isExcludedRootFile base) ||
      builtins.any (d: top == d) rootDirs;
in
builtins.filterSource
  (p: _type:
    let
      s = builtins.toString p;
      rel = if lib.hasPrefix rootWithSlash s then lib.removePrefix rootWithSlash s else s;
    in
      rel == "" ||
      (!(isExcludedPath rel)) &&
      (if roots != [] then allowByRoots rel else allowByDefault rel)
  )
  path

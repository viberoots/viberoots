{ lib, goOnly ? false, excludeCppReqs ? false, roots ? [] }:
# Returns a filter predicate for use with builtins.path { filter = ...; }.
# Callers are responsible for reading any env vars (e.g. TEST_PARTIAL_CLONE_GO_ONLY,
# TEST_EXCLUDE_CPP_REQS, TEST_RSYNC_ROOTS) and passing the derived values as args,
# keeping this function pure so the resulting store path is determined solely by the
# selected file content and does not force --impure on the enclosing derivation.
path:
let
  root = builtins.toString path;
  rootWithSlash = root + "/";
  rootDirs = [
    ".husky"
    ".viberoots"
    "build-tools"
    "cpp"
    "go"
    "lang"
    "node"
    "patches"
    "prelude"
    "python"
    "tools"
    "third_party"
    "toolchains"
    "types"
    "viberoots"
  ];
  rootMdKeep = [
    "abstractions.md"
  ];
  viberootsGeneratedRoots = [
    ".cache"
    ".clinic"
    ".codex-logs"
    ".direnv"
    ".nix-gcroots"
    ".pnpm-store"
    ".viberoots"
    "buck-out"
    "coverage"
    "node_modules"
    "result"
    "test-logs"
  ];
  isRootFile = rel: !(lib.hasInfix "/" rel) && rel != "";
  isExcludedRootFile = base:
    base == ".DS_Store" ||
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
    base == ".full-test-output.log" ||
    base == ".patch-sessions.json" ||
    base == ".patch-sessions.json.tmp" ||
    (lib.hasPrefix ".codex-" base && lib.hasSuffix ".log" base) ||
    (lib.hasPrefix "quad-alignment-" base && lib.hasSuffix ".md" base) ||
    (lib.hasPrefix "trio-alignment-" base && lib.hasSuffix ".md" base) ||
    (lib.hasSuffix ".md" base && !(lib.elem base rootMdKeep)) ||
    (lib.hasPrefix "devbuild.run." base && lib.hasSuffix ".out" base) ||
    (lib.hasPrefix "run." base && lib.hasSuffix ".out" base) ||
    (lib.hasPrefix "v." base && lib.hasSuffix ".out" base);
  isExcludedPath = rel:
    rel == ".viberoots/workspace/buck/graph.json" ||
    rel == ".viberoots/workspace/buck" ||
    (lib.hasPrefix ".viberoots/workspace/buck/" rel) ||
    rel == ".viberoots/workspace/.viberoots" ||
    (lib.hasPrefix ".viberoots/workspace/.viberoots/" rel) ||
    rel == ".viberoots/workspace/codex-test-logs" ||
    (lib.hasPrefix ".viberoots/workspace/codex-test-logs/" rel) ||
    rel == ".viberoots/buck" ||
    (lib.hasPrefix ".viberoots/buck/" rel) ||
    rel == ".viberoots/cache" ||
    (lib.hasPrefix ".viberoots/cache/" rel) ||
    rel == ".viberoots/codex-logs" ||
    (lib.hasPrefix ".viberoots/codex-logs/" rel) ||
    rel == "build-tools/tmp" ||
    (lib.hasPrefix "build-tools/tmp/" rel) ||
    builtins.any (d: rel == "viberoots/${d}" || lib.hasPrefix "viberoots/${d}/" rel) viberootsGeneratedRoots ||
    rel == "viberoots/.DS_Store" ||
    rel == "viberoots/.full-test-output.log" ||
    rel == "viberoots/.patch-sessions.json" ||
    (lib.hasPrefix "viberoots/.codex-" rel && lib.hasSuffix ".log" rel) ||
    rel == "viberoots/build-tools/tmp" ||
    (lib.hasPrefix "viberoots/build-tools/tmp/" rel) ||
    rel == ".viberoots/workspace/providers/nix_attr_map.bzl" ||
    (lib.hasPrefix ".viberoots/workspace/providers/TARGETS" rel && lib.hasSuffix ".auto" rel) ||
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
    rel == ".viberoots" ||
    lib.hasPrefix ".viberoots/" rel ||
    rel == "prelude" ||
    lib.hasPrefix "prelude/" rel ||
    rel == "viberoots" ||
    lib.hasPrefix "viberoots/" rel ||
    builtins.any (r: rel == r || lib.hasPrefix (r + "/") rel) roots;
  allowByDefault = rel:
    let
      base = builtins.baseNameOf rel;
      top = lib.head (lib.splitString "/" rel);
    in
      (isRootFile rel && !isExcludedRootFile base) ||
      builtins.any (d: top == d) rootDirs;
in
p: _type:
  let
    s = builtins.toString p;
    rel = if lib.hasPrefix rootWithSlash s then lib.removePrefix rootWithSlash s else s;
  in
    rel == "" ||
    (!(isExcludedPath rel)) &&
    (if roots != [] then allowByRoots rel else allowByDefault rel)

{ lib }:
# Returns a filter predicate for use with builtins.path { filter = ...; }.
# Callers use this as the filter argument directly rather than wrapping
# builtins.filterSource in a second builtins.path call, which avoids creating
# an unnamed intermediate store entry alongside the named one.
path:
let
  root = builtins.toString path;
in
p: _type:
let
  s = builtins.toString p;
  rel = if lib.hasPrefix (root + "/") s then lib.removePrefix (root + "/") s else "";
  relParts = lib.splitString "/" rel;
  isRootDir = d: (s == (root + "/" + d)) || (lib.hasPrefix (root + "/" + d + "/") s);
  isRootFile = f: s == (root + "/" + f);
  isHiddenViberootsGeneratedRoot = d:
    (s == (root + "/.viberoots/" + d)) || (lib.hasPrefix (root + "/.viberoots/" + d + "/") s);
  isWorkspaceGeneratedRoot = d:
    (s == (root + "/.viberoots/workspace/" + d)) ||
    (lib.hasPrefix (root + "/.viberoots/workspace/" + d + "/") s);
  isGeneratedTree = d:
    (_type == "directory" || _type == "symlink")
    && (lib.hasInfix ("/" + d + "/") s || lib.hasSuffix ("/" + d) s);
  isRootCodexLog = lib.hasPrefix (root + "/.codex-") s && lib.hasSuffix ".log" s;
  isViberootsGeneratedRoot = d:
    (s == (root + "/viberoots/" + d)) || (lib.hasPrefix (root + "/viberoots/" + d + "/") s);
  isViberootsGeneratedFile = f: s == (root + "/viberoots/" + f);
  isViberootsCodexLog =
    lib.hasPrefix (root + "/viberoots/.codex-") s && lib.hasSuffix ".log" s;
  generatedProjectRootNames = [
    ".codex-logs"
    "backups"
    "cache"
    "codex-test-logs"
    "install-cache"
    "nix-xdg-cache"
    "pr-logs"
    "result"
    "test-logs"
    "viberoots-flake-input"
    "xdg-cache"
  ];
  generatedProjectRootFiles = [
    ".full-test-output.log"
    ".patch-sessions.json"
  ];
  isProjectRootGeneratedEntry =
    builtins.length relParts == 4 &&
    builtins.elem (builtins.elemAt relParts 0) [ "projects" ] &&
    builtins.elem (builtins.elemAt relParts 1) [ "apps" "libs" ] &&
    (builtins.elem (builtins.elemAt relParts 3) generatedProjectRootNames ||
      builtins.elem (builtins.elemAt relParts 3) generatedProjectRootFiles ||
      (lib.hasPrefix ".codex-" (builtins.elemAt relParts 3) && lib.hasSuffix ".log" (builtins.elemAt relParts 3)));
in
!(
  isRootDir "coverage" ||
  isRootDir "backups" ||
  isRootDir "cache" ||
  isRootDir "codex-test-logs" ||
  isRootDir "install-cache" ||
  isRootDir "nix-xdg-cache" ||
  isRootDir "pr-logs" ||
  isRootDir "viberoots-flake-input" ||
  isRootDir "xdg-cache" ||
  isRootDir "buck-out" ||
  isRootDir ".buck" ||
  isRootDir "test-logs" ||
  isRootDir ".nix-gcroots" ||
  isRootDir "build-tools/tools/tests" ||
  isRootDir ".clinic" ||
  isRootDir ".codex-logs" ||
  isRootDir ".cache" ||
  isRootDir "result" ||
  isRootDir ".direnv" ||
  isRootDir ".git" ||
  isRootFile ".envrc" ||
  isRootFile ".full-test-output.log" ||
  isRootFile ".patch-sessions.json" ||
  isRootCodexLog ||
  isHiddenViberootsGeneratedRoot "buck" ||
  isHiddenViberootsGeneratedRoot "cache" ||
  isHiddenViberootsGeneratedRoot "codex-logs" ||
  isHiddenViberootsGeneratedRoot "codex-test-logs" ||
  isWorkspaceGeneratedRoot ".viberoots" ||
  isWorkspaceGeneratedRoot "backups" ||
  isWorkspaceGeneratedRoot "buck" ||
  isWorkspaceGeneratedRoot "cache" ||
  isWorkspaceGeneratedRoot "codex-test-logs" ||
  isWorkspaceGeneratedRoot "install-cache" ||
  isWorkspaceGeneratedRoot "nix-xdg-cache" ||
  isWorkspaceGeneratedRoot "node" ||
  isWorkspaceGeneratedRoot "pr-logs" ||
  isWorkspaceGeneratedRoot "viberoots-flake-input" ||
  isWorkspaceGeneratedRoot "xdg-cache" ||
  isViberootsGeneratedRoot ".cache" ||
  isViberootsGeneratedRoot ".clinic" ||
  isViberootsGeneratedRoot ".codex-logs" ||
  isViberootsGeneratedRoot ".direnv" ||
  isViberootsGeneratedRoot ".nix-gcroots" ||
  isViberootsGeneratedRoot ".pnpm-store" ||
  isViberootsGeneratedRoot ".viberoots" ||
  isViberootsGeneratedRoot "backups" ||
  isViberootsGeneratedRoot "buck-out" ||
  isViberootsGeneratedRoot "cache" ||
  isViberootsGeneratedRoot "codex-test-logs" ||
  isViberootsGeneratedRoot "coverage" ||
  isViberootsGeneratedRoot "install-cache" ||
  isViberootsGeneratedRoot "nix-xdg-cache" ||
  isViberootsGeneratedRoot "node_modules" ||
  isViberootsGeneratedRoot "pr-logs" ||
  isViberootsGeneratedRoot "result" ||
  isViberootsGeneratedRoot "test-logs" ||
  isViberootsGeneratedRoot "xdg-cache" ||
  isViberootsGeneratedFile ".full-test-output.log" ||
  isViberootsGeneratedFile ".patch-sessions.json" ||
  isViberootsCodexLog ||
  isProjectRootGeneratedEntry ||
  isGeneratedTree "node_modules" ||
  isGeneratedTree ".pnpm" ||
  isGeneratedTree ".pnpm-store" ||
  isGeneratedTree "dist" ||
  isGeneratedTree "build" ||
  isGeneratedTree ".vite" ||
  isGeneratedTree ".next" ||
  isGeneratedTree ".wasm-producer"
)

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
  isRootDir = d: (s == (root + "/" + d)) || (lib.hasPrefix (root + "/" + d + "/") s);
  isRootFile = f: s == (root + "/" + f);
  isGeneratedTree = d:
    (_type == "directory" || _type == "symlink")
    && (lib.hasInfix ("/" + d + "/") s || lib.hasSuffix ("/" + d) s);
in
!(
  isRootDir "coverage" ||
  isRootDir "buck-out" ||
  isRootDir ".buck" ||
  isRootDir "test-logs" ||
  isRootDir ".nix-gcroots" ||
  isRootDir "build-tools/tools/tests" ||
  isRootDir ".clinic" ||
  isRootDir ".cache" ||
  isRootDir "result" ||
  isRootDir ".direnv" ||
  isRootDir ".git" ||
  isRootFile ".envrc" ||
  isGeneratedTree "node_modules" ||
  isGeneratedTree ".pnpm" ||
  isGeneratedTree ".pnpm-store" ||
  isGeneratedTree "dist" ||
  isGeneratedTree "build" ||
  isGeneratedTree ".vite" ||
  isGeneratedTree ".next" ||
  isGeneratedTree ".wasm-producer"
)

{ lib }:
path:
builtins.filterSource
  (p: _type:
    let
      s = builtins.toString p;
      root = builtins.toString path;
      isRootDir = d: (s == (root + "/" + d)) || (lib.hasPrefix (root + "/" + d + "/") s);
      isRootFile = f: s == (root + "/" + f);
      isAnyDir = d: lib.hasInfix ("/" + d + "/") s || lib.hasSuffix ("/" + d) s;
    in
    !(
      isRootDir "coverage" ||
      isRootDir "buck-out" ||
      isRootDir ".buck" ||
      isRootDir "test-logs" ||
      isRootDir "build-tools/tools/tests" ||
      isRootDir ".clinic" ||
      isRootDir ".cache" ||
      isRootDir "result" ||
      isRootDir ".direnv" ||
      isRootDir ".git" ||
      isRootFile ".envrc" ||
      isAnyDir "node_modules" ||
      isAnyDir ".pnpm" ||
      isAnyDir ".pnpm-store"
    ))
  path



{ pkgs }:
let
  lib = pkgs.lib;
  H = import ../lib/lang-helpers.nix { inherit pkgs; };
  DevOverrideEnvs = import ../lib/dev-override-envs.nix { inherit pkgs; };
  clangxx = "${pkgs.llvmPackages.clang}/bin/clang++";
  llvmAr  = "${pkgs.llvmPackages.llvm}/bin/llvm-ar";

  # Stable sort helper for lists of strings
  sorted = xs: lib.sort (a: b: a < b) xs;
  # Internal helpers (behavior-preserving; used by app/lib/test)
  joinInc = paths: lib.concatStringsSep " " (map (p: "-I${p}") (sorted paths));
  joinDef = defs: lib.concatStringsSep " " (map (d: "-D${d}") (sorted defs));
  joinExtraC = flags: lib.concatStringsSep " " (sorted flags);

  toIncludeBase = p: if (builtins.isAttrs p && p ? dev) then p.dev else p;
  toLibBase = p: p; # libs typically live under the default output
  # Common flag joiners for nix pkgs include/lib paths (need access to toIncludeBase/toLibBase)
  nixIncFlags = pkgsList: lib.concatStringsSep " " (map (p: "-isystem ${toIncludeBase p}/include") pkgsList);
  nixLibFlags = pkgsList: lib.concatStringsSep " " (map (p: "-L${toLibBase p}/lib") pkgsList);
  nixLibDirs = pkgsList: map (p: "${toLibBase p}/lib") pkgsList;
  nixRpathFlags = pkgsList: lib.concatStringsSep " " (map (p: "-Wl,-rpath,${p}") (nixLibDirs pkgsList));

  # Standardized dev override handling (manifest-driven env name)
  cppDevOverrideEnv = DevOverrideEnvs.envNameForLang "cpp";
  devMap = H.readDevOverrides cppDevOverrideEnv;
  _ci_guard = H.guardNoDevOverridesInCI cppDevOverrideEnv;

  normalizeAttr = H.normalizeNixAttr;

  # Resolve a string attribute against pkgs (expects normalizeAttr contract).
  getAtFromPkgs = s:
    let parts0 = H.segs (normalizeAttr s);
        parts = if parts0 != [] && (lib.head parts0) == "pkgs" then lib.tail parts0 else parts0;
    in H.getAtPath pkgs parts;

  overridePkgIfAny = attr: pkg:
    let key = normalizeAttr attr;
        # Accept keys both with and without pkgs. prefix
        keyAlt = lib.removePrefix "pkgs." key;
        has = builtins.hasAttr key devMap || builtins.hasAttr keyAlt devMap;
        path = if builtins.hasAttr key devMap then devMap.${key}
               else (devMap.${keyAlt} or null);
    in if has && path != null && path != ""
       then (pkg.overrideAttrs (old: {
         src = builtins.path path;
         pname = (old.pname or "pkg") + "-dev";
         version = "0.0.0-dev";
       }))
       else pkg;

  # Map a list of nixCxxAttrs strings to concrete pkgs values (with overrides)
  resolveAttrsToPkgs = nixCxxAttrs:
    builtins.filter (v: v != null) (map (a:
      let base = getAtFromPkgs a; in if base == null then null else overridePkgIfAny a base
    ) nixCxxAttrs);

  # gtest helpers used by cppTest
  hasGTestAttr = nixCxxAttrs: builtins.any (a: lib.hasInfix "googletest" a || lib.hasInfix "gtest" a) nixCxxAttrs;
  gtestPkgsAllFor = nixCxxAttrs:
    let
      direct = builtins.filter (p: p != null) [ (getAtFromPkgs "googletest") (getAtFromPkgs "gtest") ];
      fallback = []
        ++ (if (builtins.hasAttr "googletest" pkgs) then [ pkgs.googletest ] else [])
        ++ (if (builtins.hasAttr "gtest" pkgs) then [ pkgs.gtest ] else []);
    in if direct != [] then direct else fallback;
  # Canonical Node toolchain alias used by C++ Node-API addon template
  nodeToolchain =
    if (builtins.hasAttr "nodejs_22" pkgs) then pkgs.nodejs_22
    else pkgs.nodejs;
in {
  inherit lib H clangxx llvmAr sorted joinInc joinDef joinExtraC
          toIncludeBase toLibBase nixIncFlags nixLibFlags nixLibDirs nixRpathFlags
          devMap _ci_guard normalizeAttr getAtFromPkgs overridePkgIfAny resolveAttrsToPkgs
          hasGTestAttr gtestPkgsAllFor nodeToolchain;
}



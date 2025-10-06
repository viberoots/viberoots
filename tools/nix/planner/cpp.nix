{ lib }:
ctx:
let
  get = ctx.get;
  pkgPathOf = ctx.pkgPathOf;
  T = ctx.T;

  hasPrefix = lib.hasPrefix;

  isCxx = n:
    let rt = (get n "rule_type"); in
    if rt == null then false else hasPrefix "cxx_" rt;

  hasLangCppLabel = n:
    let labels = (get n "labels"); in
    if labels == null then false else (
      let ls = if (builtins.isList labels) then labels else [];
      in lib.any (l: l == "lang:cpp") ls
    );

  kindOf = n:
    let
      rtVal = get n "rule_type";
      rt = if rtVal == null then "" else rtVal;
    in if rt == "cxx_binary" then "bin"
       else if rt == "cxx_library" then "lib"
       else if rt == "cxx_test" then "test"
       else null;

  mkApp = name:
    T.cppApp {
      inherit name;
      srcRoot = ctx.repoRoot;
      subdir = pkgPathOf name;
    };

  mkLib = name:
    T.cppLib {
      inherit name;
      srcRoot = ctx.repoRoot;
      subdir = pkgPathOf name;
    };
in {
  isTarget = n: (isCxx n) || (hasLangCppLabel n);
  inherit kindOf mkApp mkLib;
  modulesFileFor = name: "";
}



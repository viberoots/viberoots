{ pkgs }:
let
  manifestPath = ../../lib/dev-override-envs.json;
  manifestTry = builtins.tryEval (builtins.fromJSON (builtins.readFile manifestPath));
  manifest =
    if manifestTry.success && builtins.isAttrs manifestTry.value
    then manifestTry.value
    else {};

  envNameForLang = lang:
    let
      key = if builtins.isString lang then lang else "";
      v = if key != "" && builtins.hasAttr key manifest then manifest.${key} else "";
    in
      if v != "" then v
      else builtins.throw "dev override env manifest missing entry for lang: ${key}";
in {
  inherit envNameForLang;
}




{ pkgs }:
let
  lib = pkgs.lib;
in {
  # readJsonOverride — standardize dev override handling across languages
  # Params:
  #   envName: string — environment variable name to read JSON from
  #   ciForbidden: bool — if true, throw when CI=true and env is set
  # Returns:
  #   { map, warnEffect, ciGuard }
  #     map: attrset parsed from JSON or {}
  #     warnEffect: a value that triggers builtins.trace locally when set
  #     ciGuard: a value that throws in CI when set and ciForbidden=true
  readJsonOverride = { envName, ciForbidden ? true }:
    let
      raw = builtins.getEnv envName;
      parsed = if raw == "" then {} else (
        let v = builtins.fromJSON raw; in if builtins.isAttrs v then v else {}
      );
      warnEffect =
        if raw != "" && (builtins.getEnv "CI") != "true"
        then builtins.trace "[DEV OVERRIDES ACTIVE] ${envName} set; local derivation hashes will differ." null
        else null;
      ciGuard =
        if ciForbidden && (builtins.getEnv "CI") == "true" && raw != ""
        then builtins.throw "Dev overrides are forbidden in CI"
        else null;
    in {
      map = parsed;
      inherit warnEffect ciGuard;
    };
}



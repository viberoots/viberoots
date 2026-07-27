{
  pkgs,
  lib,
  kind,
  crate,
  module,
  addonName,
  targetDir,
  dynamicExtension,
}:
let
  crateFile = lib.replaceStrings [ "-" ] [ "_" ] crate;
in
if kind == "pyext" then ''
  runHook preInstall
  EXT_SUFFIX="$(${pkgs.python3}/bin/python -c \
    'import sysconfig; print(sysconfig.get_config_var("EXT_SUFFIX") or "")')"
  if [ -z "$EXT_SUFFIX" ]; then
    echo "rust Python extension ${crate}: selected interpreter has no EXT_SUFFIX" >&2
    exit 2
  fi
  candidate="${targetDir}/lib${crateFile}${dynamicExtension}"
  if [ ! -f "$candidate" ]; then
    echo "rust Python extension ${crate}: expected $candidate" >&2
    exit 2
  fi
  module_rel=${lib.escapeShellArg (lib.replaceStrings [ "." ] [ "/" ] module)}
  install -Dm755 "$candidate" "$out/site/$module_rel$EXT_SUFFIX"
  runHook postInstall
'' else if kind == "addon" then ''
  runHook preInstall
  candidate="${targetDir}/lib${crateFile}${dynamicExtension}"
  if [ ! -f "$candidate" ]; then
    echo "rust Node-API addon ${crate}: expected $candidate" >&2
    exit 2
  fi
  install -Dm755 "$candidate" "$out/lib/"${lib.escapeShellArg "${addonName}.node"}
  ${pkgs.nodejs_22}/bin/node -e \
    'const addon = require(process.argv[1]); if (addon === null || typeof addon !== "object") process.exit(2)' \
    "$out/lib/"${lib.escapeShellArg "${addonName}.node"}
  runHook postInstall
'' else
  builtins.throw "Rust extension install received unsupported kind ${kind}"

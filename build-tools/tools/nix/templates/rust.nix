{ pkgs }:
let
  lib = pkgs.lib;
  H = import ../lib/lang-helpers.nix { inherit pkgs; };
  targetNameFromLabel = label:
    let
      parts = lib.splitString ":" label;
    in
      if (builtins.length parts) > 1 then (lib.elemAt parts 1) else label;
in {
  rustApp = { name, srcRoot ? ./. }:
    let
      targetName = targetNameFromLabel name;
      sanitized = H.sanitizeName name;
    in pkgs.runCommand "rust-${sanitized}" {} ''
      mkdir -p "$out/bin"
      cat > "$out/bin/${targetName}" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
echo rust-binary:${targetName}
EOF
      cp "$out/bin/${targetName}" "$out/bin/${sanitized}"
      chmod +x "$out/bin/${targetName}" "$out/bin/${sanitized}"
    '';

  rustLib = { name, srcRoot ? ./. }:
    let
      sanitized = H.sanitizeName name;
    in pkgs.runCommand "rustlib-${sanitized}" {} ''
      mkdir -p "$out/lib"
      printf 'rust-library:%s\n' "${sanitized}" > "$out/lib/${sanitized}.rlib"
    '';
}

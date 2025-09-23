{ pkgs, buck2Input }:
{
  buck2-prelude = pkgs.stdenvNoCC.mkDerivation {
    pname = "buck2-prelude";
    version = (pkgs.buck2.version or "unstable");
    src = buck2Input;
    dontUnpack = true;
    installPhase = ''
      runHook preInstall
      mkdir -p "$out"
      cp -r "$src/prelude" "$out/prelude"
      runHook postInstall
    '';
  };
}



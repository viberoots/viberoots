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
      substituteInPlace "$out/prelude/http_file.bzl" \
        --replace-fail "        is_deferrable = True," ""
      substituteInPlace "$out/prelude/http_archive/http_archive.bzl" \
        --replace-fail "        is_deferrable = True," ""
      substituteInPlace "$out/prelude/toolchains/cxx/zig/defs.bzl" \
        --replace-fail ", is_deferrable = True" ""
      substituteInPlace "$out/prelude/utils/utils.bzl" \
        --replace-fail 'if type(src) == "artifact":' 'if isinstance(src, Artifact):'
      runHook postInstall
    '';
  };
}

{ pkgs }:

pkgs.stdenvNoCC.mkDerivation rec {
  pname = "pnpm";
  version = "11.5.3";

  src = pkgs.fetchurl {
    url = "https://registry.npmjs.org/pnpm/-/pnpm-${version}.tgz";
    hash = "sha256-I41jmkdxIni7cui22ywpesHM2A3XZC98kztzrr3ntR8=";
  };

  nativeBuildInputs = [ pkgs.nodejs-slim ];

  dontConfigure = true;
  dontBuild = true;

  postUnpack = ''
    rm -rf package/dist/reflink.*node package/dist/vendor
  '';

  installPhase = ''
    runHook preInstall
    mkdir -p "$out/bin" "$out/libexec"
    cp -R . "$out/libexec/pnpm"
    ln -s "$out/libexec/pnpm/bin/pnpm.mjs" "$out/bin/pnpm"
    ln -s "$out/libexec/pnpm/bin/pnpx.mjs" "$out/bin/pnpx"
    runHook postInstall
  '';
}

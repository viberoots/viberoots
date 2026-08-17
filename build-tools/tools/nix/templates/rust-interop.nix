{ pkgs, lib, interop, publicCrate, nativePackages }:
let
  enabled = (interop.interopKind or "") != "";
  bindingConfig = interop.bindingConfig or null;
  config = if enabled then
    builtins.fromJSON (builtins.readFile bindingConfig)
  else {};
  hasImports = enabled
    && builtins.any (fn: (fn.direction or "export") == "import") config.functions;
  isCxx = enabled && interop.interopKind == "cxx";
  sourceExtension = if isCxx then "cc" else "c";
  compiler = if isCxx
    then "${pkgs.llvmPackages.clang}/bin/clang++"
    else "${pkgs.llvmPackages.clang}/bin/clang";
  languageStandard = if isCxx then interop.cxxStandard else interop.cStandard;
  _toolchain = if !enabled then true
    else if interop.compilerFamily != "llvm"
      || interop.compilerIdentity != builtins.toString pkgs.llvmPackages.clang then
      builtins.throw "Rust interop requires the pinned LLVM compiler identity"
    else if isCxx && interop.stl != "libc++" then
      builtins.throw "Rust C++ interop requires libc++"
    else if !isCxx && interop.stl != "none" then
      builtins.throw "Rust C interop requires stl=none"
    else true;
  targetFlag = "--target=${interop.targetTriple}";
  stlFlag = lib.optionalString isCxx "-stdlib=libc++";
  generatorSources = builtins.path {
    path = ./.;
    name = "rust-interop-generator";
    filter = path: type:
      type == "directory" || builtins.elem (baseNameOf path)
        [ "rust-interop-generate.mjs" "rust-interop-schema.mjs" ];
  };
  generated = if !enabled then null else assert _toolchain; pkgs.runCommand
    "rust-interop-${publicCrate}"
    {
      nativeBuildInputs = [
        pkgs.nodejs
        pkgs.llvmPackages.clang
      ];
    }
    ''
      set -euo pipefail
      mkdir -p "$out/include" "$out/lib"
      ${pkgs.nodejs}/bin/node ${generatorSources}/rust-interop-generate.mjs \
        ${lib.escapeShellArg (builtins.toString bindingConfig)} \
        "$out/include" ${lib.escapeShellArg publicCrate} \
        ${lib.escapeShellArg interop.interopKind} \
        ${lib.escapeShellArg (interop.exceptionPolicy or "none")} \
        ${lib.escapeShellArg (interop.panicStrategy or "abort")} \
        ${lib.escapeShellArg (interop.allocator or "caller")} \
        ${lib.escapeShellArg (interop.threadSafety or "send-sync")} \
        ${lib.escapeShellArg languageStandard}
      ${lib.optionalString hasImports ''
        ${compiler} \
          -std=${languageStandard} ${stlFlag} ${targetFlag} \
          -fPIC -fno-record-gcc-switches \
          -ffile-prefix-map="$PWD"=. -I"$out/include" \
          ${lib.concatStringsSep " " (map (package: "-isystem ${package}/include") nativePackages)} \
          -c "$out/include/${publicCrate}.${sourceExtension}" -o bridge.o
        declare -a link_flags
        linked_names=" "
        for directory in ${lib.concatStringsSep " " (map (package: "${package}/lib") nativePackages)}; do
          [ -d "$directory" ] || continue
          link_flags+=("-L$directory" "-Wl,-rpath,$directory")
          for library in "$directory"/lib*.dylib "$directory"/lib*.so "$directory"/lib*.a; do
            [ -f "$library" ] || continue
            name="$(basename "$library")"; name="''${name#lib}"
            name="''${name%.dylib}"; name="''${name%.so}"; name="''${name%.a}"
            case "$linked_names" in *" $name "*) continue ;; esac
            linked_names="$linked_names$name "
            link_flags+=("-l$name")
          done
        done
        if ${if pkgs.stdenv.hostPlatform.isDarwin then "true" else "false"}; then
          ${compiler} ${stlFlag} ${targetFlag} -dynamiclib bridge.o \
            "''${link_flags[@]}" -o "$out/lib/lib${publicCrate}_rust_bridge.dylib"
        else
          ${compiler} ${stlFlag} ${targetFlag} -shared bridge.o \
            "''${link_flags[@]}" -o "$out/lib/lib${publicCrate}_rust_bridge.so"
        fi
      ''}
    '';
in {
  preBuild = lib.optionalString enabled ''
    test -f src/lib.rs || {
      echo "Rust interop requires the canonical crate root src/lib.rs for ABI verification" >&2
      exit 2
    }
    printf '\ninclude!(%s);\n' \
      ${lib.escapeShellArg (builtins.toJSON "${generated}/include/${publicCrate}.rs")} \
      >> src/lib.rs
  '';
  install = lib.optionalString enabled ''
    test ${lib.escapeShellArg (interop.interopGenerator or "")} = viberoots-rust-bindings-1
    test -f ${lib.escapeShellArg (builtins.toString bindingConfig)}
    mkdir -p "$out/include"
    cp -R ${generated}/include/. "$out/include/"
    install -Dm644 "$out/include/manifest.json" \
      "$out/share/viberoots-rust/interop-manifest.json"
  '';
  rustFlags =
    lib.optionals ((interop.panicStrategy or "") == "abort") [ "-C" "panic=abort" ]
    ++ lib.optionals hasImports [
      "-Lnative=${generated}/lib"
      "-ldylib=${publicCrate}_rust_bridge"
      "-C"
      "link-arg=-Wl,-rpath,${generated}/lib"
    ];
  buildInputs = lib.optional enabled generated;
  runtimePackages = lib.optional hasImports generated;
  passthru = interop // {
    binding_config = if bindingConfig == null then "" else builtins.toString bindingConfig;
    generated_package = generated;
  };
}

{ pkgs, cargoRoot, cargoLock, cargoOutputHashes ? {}, cargoFixedSources ? {} }:
let
  lib = pkgs.lib;
  packages = builtins.filter (package: package ? source)
    ((builtins.fromTOML (builtins.readFile cargoLock)).package or []);
  packageKey = package:
    "${lib.toLower package.name}@${package.version}#${package.source}";
  packageKeys = map packageKey packages;
  unknownFixedSources = builtins.filter
    (key: !(builtins.elem key packageKeys))
    (builtins.attrNames cargoFixedSources);
  _fixedSources =
    if unknownFixedSources == [] then true
    else builtins.throw
      "Rust fixed-source declarations are absent from Cargo.lock: ${lib.concatStringsSep ", " unknownFixedSources}";
  sourceHash = source: builtins.hashString "sha256" source;
  parseGit = source:
    let
      parts = builtins.match ''git\+([^?]+)(\?(rev|tag|branch)=([^#]+))?#(.*)'' source;
    in if parts == null then null else {
      url = builtins.elemAt parts 0;
      type = builtins.elemAt parts 2;
      value = builtins.elemAt parts 3;
      sha = builtins.elemAt parts 4;
      configKey = lib.head (lib.splitString "#" (lib.removePrefix "git+" source));
    };
  authorityFor = package:
    let
      key = packageKey package;
      git = parseGit package.source;
      fixed = cargoFixedSources.${key} or null;
      fixedKeys = if fixed == null then [] else builtins.attrNames fixed;
      unsupportedFixedKeys = builtins.filter
        (name: !(builtins.elem name [ "source" "checksum" "storePath" "narHash" "registryName" ]))
        fixedKeys;
      singleLock = pkgs.writeText
        "viberoots-rust-${sourceHash package.source}.lock"
        (''
          version = 3
          [[package]]
          name = ${builtins.toJSON package.name}
          version = ${builtins.toJSON package.version}
          source = ${builtins.toJSON package.source}
        '' + lib.optionalString (package ? checksum) ''
          checksum = ${builtins.toJSON package.checksum}
        '');
      fixedAuthority =
        if fixed != null && unsupportedFixedKeys != []
        then builtins.throw
          "Rust fixed-source materialization contains unsupported or ambient inputs for ${key}: ${lib.concatStringsSep ", " unsupportedFixedKeys}"
        else if fixed == null
        then builtins.throw "Rust immutable fixed-source materialization is unavailable: ${key}"
        else if (fixed.source or "") != package.source
          || (fixed.checksum or "") != (package.checksum or "")
        then builtins.throw "Rust fixed-source materialization identity does not match Cargo.lock: ${key}"
        else if !(fixed ? storePath) || !(fixed ? narHash)
        then builtins.throw "Rust fixed-source materialization is missing immutable path/hash inputs: ${key}"
        else builtins.path {
          path = builtins.toPath fixed.storePath;
          name = "viberoots-rust-fixed-${sourceHash key}";
          sha256 = fixed.narHash;
        };
      registryAuthority =
        if fixed != null && unsupportedFixedKeys != []
        then builtins.throw
          "Rust registry materialization contains unsupported or ambient inputs for ${key}: ${lib.concatStringsSep ", " unsupportedFixedKeys}"
        else if fixed == null then
          if package.source == "registry+https://github.com/rust-lang/crates.io-index"
          then "${pkgs.rustPlatform.importCargoLock { lockFile = singleLock; }}/${package.name}-${package.version}"
          else builtins.throw "Rust alternate registry materialization is unavailable: ${key}"
        else if (fixed.source or "") != package.source
          || (fixed.checksum or "") != (package.checksum or "")
        then builtins.throw "Rust registry materialization identity does not match Cargo.lock: ${key}"
        else if !(fixed ? storePath) || !(fixed ? narHash)
        then builtins.throw "Rust registry materialization is missing immutable path/hash inputs: ${key}"
        else if package.source != "registry+https://github.com/rust-lang/crates.io-index"
          && (fixed.registryName or "") == ""
        then builtins.throw "Rust alternate registry materialization is missing registryName: ${key}"
        else fixedAuthority;
    in if git == null then registryAuthority else fixedAuthority;
  vendorAuthorities = builtins.listToAttrs (map (package: {
    name = packageKey package;
    value = authorityFor package;
  }) packages);
  sources = lib.unique (map (package: package.source) packages);
  sourceIdentities = builtins.listToAttrs (map (source: {
    name = source;
    value = {
      hash = sourceHash source;
      replacement = "viberoots-${sourceHash source}";
      directory = sourceHash source;
    };
  }) sources);
  vendorDestinations = builtins.listToAttrs (map (package: {
    name = packageKey package;
    value =
      "${sourceIdentities.${package.source}.directory}/${package.name}-${package.version}";
  }) packages);
  configFor = source:
    let
      identity = sourceIdentities.${source};
      git = parseGit source;
      registry = lib.removePrefix "registry+" source;
      registryEntries = builtins.filter
        (package: package.source == source && cargoFixedSources ? ${packageKey package})
        packages;
      registryNames = lib.unique (map
        (package: cargoFixedSources.${packageKey package}.registryName or "")
        registryEntries);
      declaredRegistryNames = builtins.filter (name: name != "") registryNames;
      sourceDecl =
        if source == "registry+https://github.com/rust-lang/crates.io-index" then ''
          [source.crates-io]
        '' else if git != null then ''
          [source.${builtins.toJSON git.configKey}]
          git = ${builtins.toJSON git.url}
          ${lib.optionalString (git.type != null) "${git.type} = ${builtins.toJSON git.value}"}
        '' else ''
          ${lib.concatMapStringsSep "\n" (registryName: ''
            [registries.${builtins.toJSON registryName}]
            index = ${builtins.toJSON registry}
          '') declaredRegistryNames}
          [source.${builtins.toJSON registry}]
          registry = ${builtins.toJSON registry}
        '';
    in sourceDecl + ''
      replace-with = ${builtins.toJSON identity.replacement}
      [source.${builtins.toJSON identity.replacement}]
      directory = "@vendor@/${identity.directory}"
    '';
  copyFor = package:
    let
      key = packageKey package;
      identity = sourceIdentities.${package.source};
      destination = vendorDestinations.${key};
      checksum = if lib.hasPrefix "git+" package.source then null else package.checksum or null;
    in ''
      mkdir -p "$out/${identity.directory}"
      cp -R ${lib.escapeShellArg (builtins.toString vendorAuthorities.${key})} \
        "$out/${destination}"
      chmod -R u+w "$out/${destination}"
      ${if checksum == null then ''
        printf '%s\n' ${lib.escapeShellArg (builtins.toJSON {
          files = {};
          package = null;
        })} > "$out/${destination}/.cargo-checksum.json"
      '' else ''
        test -f "$out/${destination}/.cargo-checksum.json"
      ''}
    '';
  cargoVendor = pkgs.runCommand "viberoots-rust-cargo-vendor" {} ''
    mkdir -p "$out/.cargo"
    cat > "$out/.cargo/config" <<'EOF'
    ${lib.concatMapStringsSep "\n" configFor sources}
    EOF
    ${lib.concatMapStringsSep "\n" copyFor packages}
  '';
  sourceWithVendor = pkgs.runCommand "viberoots-rust-source-with-vendor" {} ''
    mkdir -p "$out"
    cp -R ${lib.escapeShellArg (builtins.toString cargoRoot)}/. "$out/"
    cp -R ${cargoVendor} "$out/.viberoots-cargo-vendor"
    mkdir "$out/.cargo"
    substitute ${cargoVendor}/.cargo/config "$out/.cargo/config" \
      --replace-warn '@vendor@' '.viberoots-cargo-vendor'
  '';
in assert _fixedSources; {
  inherit
    cargoVendor
    sourceWithVendor
    sourceIdentities
    vendorAuthorities
    vendorDestinations
    ;
}

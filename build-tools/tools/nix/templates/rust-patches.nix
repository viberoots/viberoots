{ pkgs, cargoLock, patchInputs, vendorAuthorities, devOverrides ? {} }:
let
  lib = pkgs.lib;
  lock = builtins.fromTOML (builtins.readFile cargoLock);
  packages = builtins.filter (package: package ? source) (lock.package or []);
  encodeName = name: lib.replaceStrings ["/"] ["__"] name;
  sourceHash = source: builtins.hashString "sha256" source;
  filenameFor = package:
    "${encodeName package.name}@${package.version}--${sourceHash package.source}.patch";
  patchFiles = lib.concatMap (input:
    if !(builtins.pathExists input) then []
    else if (builtins.readFileType input) == "directory" then
      map (name: {
        inherit name;
        path = input + "/${name}";
      }) (builtins.attrNames (builtins.readDir input))
    else [{
      name = builtins.baseNameOf (builtins.toString input);
      path = input;
    }]
  ) patchInputs;
  patchNames = map (entry: entry.name)
    (builtins.filter (entry: lib.hasSuffix ".patch" entry.name) patchFiles);
  expectedNames = map filenameFor packages;
  stale = builtins.filter (name: !(builtins.elem name expectedNames)) patchNames;
  records = lib.concatMap (package:
    let
      expected = filenameFor package;
      matching = builtins.filter (entry: entry.name == expected) patchFiles;
      key = "${lib.toLower package.name}@${package.version}#${package.source}";
      override = devOverrides.${key} or null;
      vendorAuthority = vendorAuthorities.${key} or
        (builtins.throw "Rust dependency source authority is unavailable: ${key}");
    in if lib.length matching > 1 then
      builtins.throw "Rust dependency patch is duplicated: ${expected}"
    else if matching == [] && override == null then []
    else [{
      inherit (package) name version source;
      checksum = package.checksum or "";
      patch = if matching == [] then null else (builtins.head matching).path;
      inherit override vendorAuthority;
    }]
  ) packages;
  commandFor = record:
    let
      patchCommand = if record.patch == null then "" else ''
        ${pkgs.patch}/bin/patch -d "$crate_source" -p1 \
          -i ${lib.escapeShellArg (builtins.toString record.patch)}
      '';
      overrideCommand = if record.override == null then "" else ''
        echo "[DEV OVERRIDES ACTIVE] Rust exact fixed source override: ${record.name}@${record.version}#${record.source}" >&2
        test -d ${lib.escapeShellArg (builtins.toString record.override)}
        rm -rf "$crate_source"
        cp -R --reflink=auto ${lib.escapeShellArg (builtins.toString record.override)} "$crate_source"
        chmod -R u+w "$crate_source"
        printf '%s\n' ${lib.escapeShellArg (builtins.toJSON {
          files = {};
          package = if record.checksum == "" then null else record.checksum;
        })} > "$crate_source/.cargo-checksum.json"
      '';
      refreshChecksums = ''
        checksum_file="$crate_source/.cargo-checksum.json"
        package_json="$(${pkgs.jq}/bin/jq -c '.package' "$checksum_file")"
        next_checksum="$TMPDIR/viberoots-cargo-checksum.json"
        printf '{"files":{},"package":%s}\n' "$package_json" > "$next_checksum"
        while IFS= read -r -d "" source_file; do
          relative_path="''${source_file#"$crate_source/"}"
          file_hash="$(${pkgs.coreutils}/bin/sha256sum "$source_file")"
          file_hash="''${file_hash%% *}"
          ${pkgs.jq}/bin/jq \
            --arg path "$relative_path" \
            --arg hash "$file_hash" \
            '.files[$path] = $hash' \
            "$next_checksum" > "$next_checksum.updated"
          mv "$next_checksum.updated" "$next_checksum"
        done < <(find "$crate_source" -type f ! -name .cargo-checksum.json -print0 | sort -z)
        mv "$next_checksum" "$checksum_file"
      '';
    in ''
      crate_matches=()
      while IFS= read -r candidate; do
        if ${pkgs.diffutils}/bin/diff -qr \
          --exclude=.cargo-checksum.json \
          --exclude=.cargo-config \
          --exclude=.cargo_vcs_info.json \
          --exclude=.git \
          "$candidate" ${lib.escapeShellArg (builtins.toString record.vendorAuthority)} \
          >/dev/null; then
          crate_matches+=("$candidate")
        fi
      done < <({
        find "$cargoDepsCopy" -mindepth 1 -maxdepth 1 -type d -print
        find "$cargoDepsCopy" -mindepth 2 -type f \
          -name Cargo.toml -exec dirname {} \;
      } | sort -u)
      if [ "''${#crate_matches[@]}" -ne 1 ]; then
        echo "Rust dependency source ${record.name}@${record.version}#${record.source}: expected one exact vendored identity, found ''${#crate_matches[@]}" >&2
        exit 2
      fi
      crate_source="''${crate_matches[0]}"
      ${overrideCommand}
      ${patchCommand}
      ${refreshChecksums}
    '';
in
if stale != [] then
  builtins.throw "Rust patch inventory contains stale or ambiguous entries: ${lib.concatStringsSep ", " stale}"
else {
  inherit records;
  postPatch = lib.concatMapStringsSep "\n" commandFor records;
}

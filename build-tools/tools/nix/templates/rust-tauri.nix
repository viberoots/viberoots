{ pkgs, lib, kind, tauri, targetName, cargoTarget, cargoProfile }:
let
  active = kind == "tauri";
  cargoTauri = pkgs.cargo-tauri;
  config = if active then tauri.config else null;
  root = if active then tauri.root else ".";
  frontend = if active then tauri.frontend else null;
  capabilities = if active then tauri.capabilities else [];
  permissions = if active then tauri.permissions else [];
  resources = if active then tauri.resources else [];
  icons = if active then tauri.icons else [];
  sidecars = if active then tauri.sidecars else [];
  rawAppCommands = if active then tauri.appCommands else [];
  appCommands =
    if builtins.all
      (command: builtins.isString command && builtins.match "^[A-Za-z_][A-Za-z0-9_]*$" command != null)
      rawAppCommands
    then rawAppCommands
    else builtins.throw "tauri_app: app_commands must use conservative Rust/Tauri command identifiers";
  appWindows = if active then tauri.appWindows else [];
  declaredResources = builtins.listToAttrs (map (record: {
    name = record.source;
    value = record.destination;
  }) resources);
  resourceManifest = map (record: {
    inherit (record) source destination;
  }) resources;
  sidecarManifest = map (record: {
    inherit (record) label destination;
  }) sidecars;
  declaredIcons = map builtins.baseNameOf icons;
  appPermissions = map
    (command: "allow-${lib.replaceStrings [ "_" ] [ "-" ] command}")
    appCommands;
  reviewedCsp = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self' ipc: http://ipc.localhost";
  allowedCapabilityPermissions = [ "core:default" ] ++ appPermissions;
  capabilityPolicy = value: ''
    capability_path=${lib.escapeShellArg (builtins.toString value)}
    ${pkgs.jq}/bin/jq -e \
      --argjson allowed_permissions ${lib.escapeShellArg (builtins.toJSON allowedCapabilityPermissions)} \
      --argjson allowed_windows ${lib.escapeShellArg (builtins.toJSON appWindows)} '
      (.identifier | type == "string" and test("^[A-Za-z_][A-Za-z0-9_-]*$"))
      and (.windows | type == "array" and length > 0 and all(type == "string"))
      and (.permissions | type == "array" and all(type == "string"))
      and ((.windows | length) == (.windows | unique | length))
      and ((.permissions | length) == (.permissions | unique | length))
      and all(.windows[]; IN($allowed_windows[]))
      and all(.permissions[]; IN($allowed_permissions[]))
      and ([.windows[], .permissions[] | select(. == "*" or test("(^|:)\\*$"))] | length == 0)
    ' "$capability_path" >/dev/null ||
      { printf '%s\n' ${lib.escapeShellArg "tauri_app: capability contains an undeclared, duplicate, wildcard, plugin, or future window/permission: ${builtins.baseNameOf value}"} >&2; exit 2; }
    ${pkgs.jq}/bin/jq -c \
      --arg source ${lib.escapeShellArg (builtins.baseNameOf value)} \
      '{source:$source, identifier, windows, permissions}' \
      "$capability_path" >> .viberoots-capabilities.ndjson
    ${pkgs.jq}/bin/jq -r '.identifier' "$capability_path" >> .viberoots-capability-identifiers
    ${pkgs.jq}/bin/jq -r '.windows[]' "$capability_path" >> .viberoots-capability-windows
    ${pkgs.jq}/bin/jq -r '.permissions[]' "$capability_path" >> .viberoots-capability-permissions
  '';
in {
  nativeBuildInputs = lib.optionals active [
    cargoTauri
    pkgs.jq
    pkgs.python3
    pkgs.apple-sdk
    pkgs.rcodesign
  ];
  buildInputs = lib.optionals active [ pkgs.apple-sdk ];
  preBuild = lib.optionalString active ''
    test "${pkgs.stdenv.hostPlatform.system}" = "aarch64-darwin" ||
      { echo "tauri_app: only aarch64-darwin has reviewed native package and launch evidence" >&2; exit 2; }
    test -f ${lib.escapeShellArg (builtins.toString config)}
    ${pkgs.jq}/bin/jq --arg reviewed_csp ${lib.escapeShellArg reviewedCsp} \
      --argjson windows ${lib.escapeShellArg (builtins.toJSON appWindows)} -e '
      (.build.frontendDist == "frontend-dist")
      and (.build.devUrl == null)
      and (.build.beforeBuildCommand == null)
      and (.build.beforeDevCommand == null)
      and ((.plugins // {}) == {})
      and (.app.withGlobalTauri == false)
      and (([.app.windows[].label] | sort) == ($windows | sort))
      and ((.bundle.createUpdaterArtifacts // false) == false)
      and ((.bundle.externalBin // []) == [])
      and (.bundle.macOS.signingIdentity == null)
      and (.bundle.macOS.entitlements == null)
      and (.app.security.csp == $reviewed_csp)
      and ([.. | strings | select(
        test("(^|[ ;])\u0027unsafe-(eval|inline)\u0027([ ;]|$)")
        or . == "*"
        or test("(^|[ ;])\\*([ ;]|$)")
        or (test("^(https?|wss?)://") and . != "http://ipc.localhost")
      )] | length == 0)
    ' ${lib.escapeShellArg (builtins.toString config)} >/dev/null ||
      { echo "tauri_app: config must use the reviewed offline frontend, hook/plugin, updater, and CSP policy" >&2; exit 2; }
    test -z "''${APPLE_SIGNING_IDENTITY-}" ||
      { echo "tauri_app: ambient Apple signing identity is forbidden" >&2; exit 2; }
    for signing_secret in APPLE_CERTIFICATE APPLE_CERTIFICATE_PASSWORD APPLE_PASSWORD APPLE_ID APPLE_TEAM_ID; do
      test -z "$(eval "printf %s \"\''${$signing_secret-}\"")" ||
        { echo "tauri_app: ambient Apple signing credentials are forbidden" >&2; exit 2; }
    done
    configured_resources="$(${pkgs.jq}/bin/jq -cS '(.bundle.resources // {})' ${lib.escapeShellArg (builtins.toString config)})"
    test "$configured_resources" = ${lib.escapeShellArg (builtins.toJSON declaredResources)} ||
      { echo "tauri_app: config resource source/destination mappings disagree with declared resources" >&2; exit 2; }
    configured_icons="$(${pkgs.jq}/bin/jq -c '(.bundle.icon // []) | map(split("/")[-1]) | sort' ${lib.escapeShellArg (builtins.toString config)})"
    test "$configured_icons" = ${lib.escapeShellArg (builtins.toJSON (builtins.sort (a: b: a < b) declaredIcons))} ||
      { echo "tauri_app: config icons disagree with declared icon inputs" >&2; exit 2; }
    if grep -Eq '(^|["[:space:]])tauri-plugin-' Cargo.toml Cargo.lock; then
      echo "tauri_app: arbitrary tauri-plugin dependencies require a separate reviewed contract" >&2
      exit 2
    fi
    test ${lib.escapeShellArg root} = "." || test ${lib.escapeShellArg root} = "src-tauri" ||
      { echo "tauri_app: tauri root escaped its reviewed layout" >&2; exit 2; }
    ${pkgs.python3}/bin/python3 - \
      ${lib.escapeShellArg (builtins.toJSON (builtins.listToAttrs (map (command: {
        name = "allow-${lib.replaceStrings [ "_" ] [ "-" ] command}";
        value = command;
      }) appCommands)))} \
      ${lib.concatMapStringsSep " " (value: lib.escapeShellArg (builtins.toString value)) permissions} <<'PY' || exit 2
    import json
    import pathlib
    import sys
    import tomllib

    expected = json.loads(sys.argv[1])
    observed = {}
    observed_commands = set()
    for filename in sys.argv[2:]:
        with pathlib.Path(filename).open("rb") as stream:
            document = tomllib.load(stream)
        if set(document) != {"permission"} or not isinstance(document["permission"], list):
            raise SystemExit("tauri_app: permission TOML must contain only [[permission]] tables")
        for permission in document["permission"]:
            if not isinstance(permission, dict):
                raise SystemExit("tauri_app: permission TOML contains a malformed permission table")
            if set(permission) - {"identifier", "description", "commands"}:
                raise SystemExit("tauri_app: permission TOML contains extra permission authority")
            identifier = permission.get("identifier")
            commands = permission.get("commands")
            if not isinstance(identifier, str) or not identifier or identifier in observed:
                raise SystemExit("tauri_app: permission identifiers must be non-empty and unique")
            if not isinstance(commands, dict) or set(commands) != {"allow"}:
                raise SystemExit("tauri_app: permission commands must contain only commands.allow")
            allowed = commands["allow"]
            if (
                not isinstance(allowed, list)
                or len(allowed) != 1
                or not isinstance(allowed[0], str)
                or "*" in allowed[0]
            ):
                raise SystemExit("tauri_app: permission commands.allow must name one exact command")
            command = allowed[0]
            if command in observed_commands:
                raise SystemExit("tauri_app: permission commands.allow mappings must be unique")
            if expected.get(identifier) != command:
                raise SystemExit("tauri_app: permission identifier and commands.allow disagree")
            observed[identifier] = command
            observed_commands.add(command)
    if observed != expected:
        raise SystemExit("tauri_app: declared permissions do not exactly cover app_commands")
    PY
    : > .viberoots-capabilities.ndjson
    : > .viberoots-capability-identifiers
    : > .viberoots-capability-windows
    : > .viberoots-capability-permissions
    ${lib.concatMapStringsSep "\n" capabilityPolicy capabilities}
    ${pkgs.jq}/bin/jq -s '.' .viberoots-capabilities.ndjson > .viberoots-capabilities.json
    capability_identifiers="$(${pkgs.jq}/bin/jq -Rsc 'split("\n")[:-1] | sort' .viberoots-capability-identifiers)"
    test "$capability_identifiers" = "$(${pkgs.jq}/bin/jq -Rsc 'split("\n")[:-1] | unique | sort' .viberoots-capability-identifiers)" ||
      { printf '%s\n' ${lib.escapeShellArg "tauri_app: capability identifiers must be unique"} >&2; exit 2; }
    configured_capabilities="$(${pkgs.jq}/bin/jq -c '(.app.security.capabilities // []) | sort' ${lib.escapeShellArg (builtins.toString config)})"
    test "$configured_capabilities" = "$capability_identifiers" ||
      { printf '%s\n' ${lib.escapeShellArg "tauri_app: config capabilities disagree with declared capability identifiers"} >&2; exit 2; }
    capability_windows="$(${pkgs.jq}/bin/jq -Rsc 'split("\n")[:-1] | sort' .viberoots-capability-windows)"
    test "$capability_windows" = ${lib.escapeShellArg (builtins.toJSON (builtins.sort (a: b: a < b) appWindows))} ||
      { printf '%s\n' ${lib.escapeShellArg "tauri_app: configured app_windows must each have one unambiguous capability owner"} >&2; exit 2; }
    capability_app_permissions="$(${pkgs.jq}/bin/jq -Rsc 'split("\n")[:-1] | map(select(. != "core:default")) | unique | sort' .viberoots-capability-permissions)"
    test "$capability_app_permissions" = ${lib.escapeShellArg (builtins.toJSON (builtins.sort (a: b: a < b) appPermissions))} ||
      { printf '%s\n' ${lib.escapeShellArg "tauri_app: every declared app command must be admitted by at least one exact capability mapping"} >&2; exit 2; }
    frontend_root=${lib.escapeShellArg (builtins.toString frontend)}
    if [ -d "$frontend_root/dist" ]; then frontend_root="$frontend_root/dist"; fi
    test -d "$frontend_root" || { echo "tauri_app: frontend_dist is not a directory artifact" >&2; exit 2; }
    test -f "$frontend_root/index.html" || { echo "tauri_app: frontend_dist is missing index.html" >&2; exit 2; }
    ${pkgs.jq}/bin/jq --arg frontend "$frontend_root" \
      '.build.frontendDist = $frontend' \
      ${lib.escapeShellArg (builtins.toString config)} > .viberoots-tauri.conf.json
  '';
  buildPhase = lib.optionalString active ''
    runHook preBuild
    export CARGO_NET_OFFLINE=true
    export MACOSX_DEPLOYMENT_TARGET=14.0
    ${cargoTauri}/bin/cargo-tauri tauri build --config .viberoots-tauri.conf.json
    runHook postBuild
  '';
  installPhase = lib.optionalString active ''
    runHook preInstall
    mkdir -p "$out/bin" "$out/app" "$out/share/viberoots-tauri/resources" "$out/share/viberoots-tauri/sidecars"
    binary="target/${cargoTarget}/${cargoProfile}/${targetName}"
    if [ ! -x "$binary" ]; then binary="target/${cargoProfile}/${targetName}"; fi
    test -x "$binary" || { echo "tauri_app: built application executable is missing" >&2; exit 2; }
    cp "$binary" "$out/bin/${targetName}"
    app_bundle="$(find target -type d -path '*/bundle/macos/*.app' -print -quit)"
    test -n "$app_bundle" || { echo "tauri_app: credential-free ad-hoc macOS application bundle is missing" >&2; exit 2; }
    cp -R "$app_bundle" "$out/app/"
    packaged_app="$out/app/$(basename "$app_bundle")"
    app_executable=""
    for candidate in "$packaged_app/Contents/MacOS/"*; do
      if [ -f "$candidate" ] && [ -x "$candidate" ]; then
        app_executable="$candidate"
        break
      fi
    done
    test -n "$app_executable" ||
      { echo "tauri_app: packaged application executable is missing" >&2; exit 2; }
    ${pkgs.rcodesign}/bin/rcodesign print-signature-info "$app_executable" > .viberoots-signature-info
    grep -Eq '^          flags: .*ADHOC' .viberoots-signature-info &&
      grep -Eq '^        cms: null$' .viberoots-signature-info ||
      { echo "tauri_app: executable must retain only the credential-free platform ad-hoc envelope" >&2; exit 2; }
    sidecar_bundle="$packaged_app/Contents/Resources/viberoots-sidecars"
    mkdir -p "$sidecar_bundle"
    ${lib.concatMapStringsSep "\n" (record:
      "mkdir -p \"$out/share/viberoots-tauri/resources/$(dirname ${lib.escapeShellArg record.destination})\"; cp -R ${lib.escapeShellArg (builtins.toString record.path)} \"$out/share/viberoots-tauri/resources/${record.destination}\""
    ) resources}
    ${lib.concatMapStringsSep "\n" (record:
      "mkdir -p \"$sidecar_bundle/$(dirname ${lib.escapeShellArg record.destination})\" \"$out/share/viberoots-tauri/sidecars/$(dirname ${lib.escapeShellArg record.destination})\"; cp -R ${lib.escapeShellArg (builtins.toString record.artifact)} \"$sidecar_bundle/${record.destination}\"; cp -R ${lib.escapeShellArg (builtins.toString record.artifact)} \"$out/share/viberoots-tauri/sidecars/${record.destination}\""
    ) sidecars}
    ${pkgs.jq}/bin/jq -n \
      --arg platform ${lib.escapeShellArg tauri.platform} \
      --arg frontend ${lib.escapeShellArg (builtins.toString frontend)} \
      --arg app_executable "$app_executable" \
      --argjson resources ${lib.escapeShellArg (builtins.toJSON resourceManifest)} \
      --slurpfile capabilities .viberoots-capabilities.json \
      --argjson icons ${lib.escapeShellArg (builtins.toJSON declaredIcons)} \
      --argjson sidecars ${lib.escapeShellArg (builtins.toJSON sidecarManifest)} \
      --argjson app_commands ${lib.escapeShellArg (builtins.toJSON appCommands)} \
      --argjson app_windows ${lib.escapeShellArg (builtins.toJSON appWindows)} \
      '{schema:"viberoots.tauri-artifact.v1", platform:$platform, frontend:$frontend, appExecutable:$app_executable, appWindows:$app_windows, withGlobalTauri:false, appCommands:$app_commands, resources:$resources, capabilities:$capabilities[0], icons:$icons, sidecars:$sidecars, signature:{mode:"adhoc-platform", credentialed:false, teamIdentifier:null, signingIdentity:null, releaseSigned:false, releaseAdmitted:false}}' \
      > "$out/share/viberoots-tauri/artifact-manifest.json"
    runHook postInstall
  '';
}

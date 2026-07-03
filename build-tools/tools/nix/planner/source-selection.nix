{ lib
, pkgs
, get
, registryPath
, registryInput ? null
, system ? pkgs.stdenv.hostPlatform.system
, selectedTargetName ? ""
, activeDevOverrideLanguages ? [ ]
, activeDevOverrideEnvs ? [ ]
}:
let
  registry =
    if registryInput != null then registryInput
    else if builtins.pathExists registryPath then (
      let
        raw = import registryPath;
      in if builtins.isFunction raw then raw { } else raw
    )
    else builtins.throw (
      "nixpkgs source registry missing for "
      + (if selectedTargetName == "" then "selected target" else selectedTargetName)
      + ": expected registry at "
      + builtins.toString registryPath
    );

  H = import ../lib/lang-helpers.nix { inherit pkgs; };
  fail = msg: builtins.throw ("nixpkgs source registry: " + msg);

  schemaVersion =
    if registry ? schemaVersion && builtins.isString registry.schemaVersion
    then registry.schemaVersion
    else fail "schemaVersion must be a string";

  profiles =
    if registry ? profiles && builtins.isAttrs registry.profiles
    then registry.profiles
    else fail "profiles must be an attribute set";

  _schema =
    if schemaVersion == "nixpkgs-source-registry@1" then null
    else fail ("unsupported schemaVersion " + schemaVersion);

  _default =
    if builtins.hasAttr "default" profiles then null
    else fail "profiles.default is required";

  validateProfile = name: profile:
    let
      rationale = profile.rationale or null;
      systems = profile.supportedSystems or [ ];
      rationaleOk = rationale == null || builtins.isString rationale;
      systemsOk = builtins.isList systems && builtins.all builtins.isString systems;
      supported = systems == [ ] || builtins.elem system systems;
    in
      if !builtins.isAttrs profile then fail ("profile " + name + " must be an attribute set")
      else if !rationaleOk then fail ("profile " + name + " rationale must be a string")
      else if !systemsOk then fail ("profile " + name + " supportedSystems must be a list of strings")
      else if !supported then fail ("profile " + name + " does not support system " + system)
      else profile;

  validatedProfiles =
    builtins.seq _schema (builtins.seq _default (builtins.mapAttrs validateProfile profiles));

  targetText =
    if selectedTargetName == "" then "selected target" else selectedTargetName;

  targetNameFor = node:
    let raw = if node == null then null else get node "name"; in
      if builtins.isString raw && raw != "" then H.normalizeTargetLabel raw
      else targetText;

  recordTarget = record: record.target_label or targetText;

  nixpkgIdentityKey = record:
    let
      attr = record.attr or "";
      profileName = record.profile_name or (record.profile or "");
    in profileName + "::" + attr;

  describeNixpkgRecord = record:
    "target " + (recordTarget record)
    + ", attr " + (record.attr or "<missing>")
    + ", profile " + (record.profile_name or (record.profile or "<missing>"))
    + ", resolution_kind " + (record.resolution_kind or "<missing>");

  sameResolution = left: right:
    (left.resolution_kind or "") == (right.resolution_kind or "")
    && (left.rationale or null) == (right.rationale or null);

  dedupeNixpkgRecords = records:
    let
      step = state: record:
        let
          key = nixpkgIdentityKey record;
          prior = state.seen.${key} or null;
        in
          if prior == null then {
            seen = state.seen // { "${key}" = record; };
            out = state.out ++ [ record ];
          }
          else if sameResolution prior record then state
          else builtins.throw (
            "nixpkgs source registry: conflicting nixpkg source resolution for "
            + describeNixpkgRecord record
            + "; previous resolution_kind "
            + (prior.resolution_kind or "<missing>")
          );
    in (builtins.foldl' step { seen = {}; out = []; } records).out;

  pkgsForProfile = profileName:
    if !(builtins.isString profileName) then fail "profile name must be a string"
    else if !(builtins.hasAttr profileName validatedProfiles) then fail (
      "unknown profile " + profileName + " for " + targetText
      + "; registry path: " + builtins.toString registryPath
    )
    else
      let profile = validatedProfiles.${profileName}; in
      if profileName == "default" then pkgs
      else if !(profile ? input) || profile.input == null then fail ("profile " + profileName + " is missing input")
      else import profile.input {
        inherit system;
        config = profile.config or { };
        overlays = profile.overlays or [ ];
      };

  profileNameFor = node:
    let raw = if node == null then null else get node "nixpkgs_profile"; in
      if raw == null then "default"
      else if builtins.isString raw then raw
      else fail "nixpkgs_profile must be a string";

  pinsFor = node:
    let raw = if node == null then null else get node "nixpkg_pins"; in
      if raw == null then { }
      else if !(builtins.isAttrs raw) then fail "nixpkg_pins must be an attrset"
      else if raw != { } then fail "non-empty nixpkg_pins are not supported until package-pin resolution lands"
      else raw;

  sourcePlanFor = node:
    let
      profileName = profileNameFor node;
      nixpkgPins = pinsFor node;
      sourceSelectionActive = profileName != "default" || nixpkgPins != {};
      activeDevOverrideText = builtins.concatStringsSep ", " activeDevOverrideLanguages;
      activeDevOverrideEnvText = builtins.concatStringsSep ", " activeDevOverrideEnvs;
      _devOverridePolicy =
        if sourceSelectionActive && activeDevOverrideLanguages != [] then fail (
          "dev overrides are not supported for non-default nixpkgs source plans until "
          + "profile-qualified overrides land; target " + (targetNameFor node)
          + ", nixpkgs_profile " + profileName
          + ", active override languages " + activeDevOverrideText
          + ", active override envs " + activeDevOverrideEnvText
          + "; next: unset the dev override env vars or use nixpkgs_profile = \"default\""
        )
        else null;
      basePkgs = pkgsForProfile profileName;
    in builtins.seq _devOverridePolicy (builtins.seq basePkgs {
      nixpkgs_profile = profileName;
      nixpkg_pins = nixpkgPins;
      base_pkgs = basePkgs;
    });

  resolveNixpkgAttr = { target, attr }:
    let
      normalizedAttr = H.normalizeNixAttr attr;
      plan = sourcePlanFor target;
      profileName = plan.nixpkgs_profile;
      parts0 = lib.splitString "." normalizedAttr;
      parts = if parts0 != [ ] && lib.head parts0 == "pkgs" then lib.tail parts0 else parts0;
      package0 = lib.attrByPath parts null plan.base_pkgs;
      package =
        if package0 != null then package0
        else if normalizedAttr == "pkgs.googletest" then plan.base_pkgs.gtest or null
        else null;
    in {
      attr = normalizedAttr;
      profile_name = profileName;
      profile = profileName;
      resolution_kind = "nixpkgs_profile";
      rationale = null;
      identity_key = nixpkgIdentityKey {
        attr = normalizedAttr;
        profile_name = profileName;
      };
      target_label = targetNameFor target;
      inherit package;
    };

  resolveNixpkgAttrs = { target, attrs }:
    dedupeNixpkgRecords (map (attr: resolveNixpkgAttr { inherit target attr; }) attrs);
in
{
  nixpkgsRegistry = builtins.seq _schema (builtins.seq _default (registry // { profiles = validatedProfiles; }));
  inherit
    pkgsForProfile
    sourcePlanFor
    resolveNixpkgAttr
    resolveNixpkgAttrs
    nixpkgIdentityKey
    describeNixpkgRecord
    dedupeNixpkgRecords;
}

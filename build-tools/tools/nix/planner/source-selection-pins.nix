{ lib
, H
, fail
, get
, registryPath
, validatedProfiles
, targetNameFor
}:
let
  validatePinProfile = targetName: normalizedAttr: profileName:
    if !(builtins.isString profileName) || lib.trim profileName == "" then fail (
      "nixpkg_pins[" + normalizedAttr + "].nixpkgs_profile must be a non-empty string"
      + " for target " + targetName
    )
    else if !(builtins.hasAttr profileName validatedProfiles) then fail (
      "unknown profile " + profileName
      + " in nixpkg_pins[" + normalizedAttr + "] for target " + targetName
      + "; registry path: " + builtins.toString registryPath
    )
    else profileName;

  validatePinEntry = targetName: rawAttr: rawEntry:
    let
      normalizedAttr = H.normalizeNixAttr rawAttr;
      profileName = validatePinProfile targetName normalizedAttr (rawEntry.nixpkgs_profile or null);
      rationale = rawEntry.rationale or null;
    in
      if normalizedAttr == "" then fail ("nixpkg_pins contains an empty nixpkgs attr key for target " + targetName)
      else if !(builtins.isAttrs rawEntry) then fail (
        "nixpkg_pins[" + normalizedAttr + "] must be an attrset for target " + targetName
      )
      else if !(builtins.isString rationale) || lib.trim rationale == "" then fail (
        "nixpkg_pins[" + normalizedAttr + "].rationale must be a non-empty string"
        + " for target " + targetName
      )
      else {
        name = normalizedAttr;
        value = {
          inherit profileName;
          nixpkgs_profile = profileName;
          rationale = lib.trim rationale;
        };
      };

  pinsFor = node:
    let
      raw = if node == null then null else get node "nixpkg_pins";
      targetName = targetNameFor node;
      step = state: rawAttr:
        let
          entry = validatePinEntry targetName rawAttr raw.${rawAttr};
          prior = state.out.${entry.name} or null;
        in
          if prior != null then fail (
            "duplicate normalized nixpkg_pins key " + entry.name + " for target " + targetName
          )
          else { out = state.out // { "${entry.name}" = entry.value; }; };
    in
      if raw == null then { }
      else if !(builtins.isAttrs raw) then fail "nixpkg_pins must be an attrset"
      else (builtins.foldl' step { out = {}; } (builtins.attrNames raw)).out;
in
{
  inherit pinsFor;
}

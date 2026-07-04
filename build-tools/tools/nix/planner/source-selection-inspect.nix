{ lib }:
{
  inspectionLines = { targetLabel, plan, records }:
    let
      pinAttrs = builtins.attrNames (plan.nixpkg_pins or {});
      pinSummary =
        if pinAttrs == []
        then "none"
        else builtins.concatStringsSep "," pinAttrs;
      recordLine = record:
        "target=" + targetLabel
        + " nixpkgs_profile=" + plan.nixpkgs_profile
        + " attr=" + record.attr
        + " profile=" + record.profile_name
        + " resolution_kind=" + record.resolution_kind
        + (
          if record.rationale == null
          then ""
          else " rationale=" + lib.escapeShellArg record.rationale
        );
    in
      [
        (
          "target=" + targetLabel
          + " nixpkgs_profile=" + plan.nixpkgs_profile
          + " nixpkg_pins=" + pinSummary
        )
      ] ++ map recordLine records;
}

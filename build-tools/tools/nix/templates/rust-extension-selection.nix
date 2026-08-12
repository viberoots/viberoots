{ pkgs, Contract }:
{
  kind,
  module,
  buildPyDeps,
  addonName,
  nodeApiVersion,
  platform,
  pythonAbi,
}:
Contract.validateExtension {
  inherit kind module buildPyDeps addonName nodeApiVersion platform pythonAbi;
  selectedPythonAbi =
    "cp${pkgs.lib.versions.major pkgs.python3.pythonVersion}${pkgs.lib.versions.minor pkgs.python3.pythonVersion}";
  selectedNodeApiVersion = 10;
  system = pkgs.stdenv.hostPlatform.system;
}

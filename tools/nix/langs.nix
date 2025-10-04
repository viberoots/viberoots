# tools/nix/langs.nix — GENERATED FILE — DO NOT EDIT.
# Exposes a simple attribute set mapping language id -> capability flags.
{
  go = {
    patching = true;
    lockfileLabels = false;
    testAutoWire = true;
  };
  node = {
    patching = true;
    lockfileLabels = true;
    testAutoWire = false;
  };
}

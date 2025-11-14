# tools/nix/langs.nix — GENERATED FILE — DO NOT EDIT.
# Exposes a simple attribute set mapping language id -> capability flags.
{
  cpp = {
    patching = true;
  };
  go = {
    lockfileLabels = false;
    patching = true;
    testAutoWire = true;
  };
  node = {
    lockfileLabels = true;
    patching = true;
    testAutoWire = false;
  };
  rust = {

  };
}

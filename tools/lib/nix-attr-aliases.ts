// Tiny alias table for nixpkgs attribute normalization.
// Keys MUST be already-normalized (lowercased with a leading "pkgs." prefix).
// Keep this list small and conservative to avoid unexpected remaps.
export const NIX_ATTR_ALIASES: Record<string, string> = {
  "pkgs.gtest": "pkgs.googletest",
};

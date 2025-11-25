def global_nix_inputs():
    """
    Centralized global Nix inputs stamping policy (PR‑5).
    Prefer builder/Nix-level consideration; when macro-level stamping is justified,
    consume this helper instead of hardcoding labels in macros.
    """
    # Current policy: include repo-level flake.lock as a single global input.
    # This keeps behavior consistent across languages and avoids ad-hoc stamping.
    return ["//:flake.lock"]



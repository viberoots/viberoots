def _replace_all(hay, needle, repl):
    if needle == "":
        return hay
    return repl.join(hay.split(needle))


def sanitize_name(s):
    """
    Canonical sanitizer for labels and attribute names.

    This mirrors the flake-side sanitizer used in tools/nix/lib/lang-helpers.nix:
      lib.replaceStrings ["//" ":" "/" " "] ["" "-" "-" "-"] s

    All languages should import and use this helper to avoid drift.
    """
    s1 = _replace_all(s, "//", "")
    s2 = _replace_all(s1, ":", "-")
    s3 = _replace_all(s2, "/", "-")
    s4 = _replace_all(s3, " ", "-")
    return s4


__all__ = [
    "sanitize_name",
]




def _replace_all(hay, needle, repl):
    if needle == "":
        return hay
    return repl.join(hay.split(needle))


def sanitize_name(s):
    """
    Canonical sanitizer for labels and attribute names.

    This mirrors the flake-side sanitizer used in build-tools/tools/nix/lib/lang-helpers.nix:
      lib.replaceStrings ["//" ":" "/" " "] ["" "-" "-" "-"] s

    All languages should import and use this helper to avoid drift.
    """
    s1 = _replace_all(s, "//", "")
    s2 = _replace_all(s1, ":", "-")
    s3 = _replace_all(s2, "/", "-")
    s4 = _replace_all(s3, " ", "-")
    return s4


# Test-only probe to surface sanitizer output as a declared artifact
def _sanitize_probe_impl(ctx):
    val = sanitize_name(ctx.attrs.value)
    out = ctx.actions.declare_output(ctx.attrs.out)
    ctx.actions.write(out, val + "\n")
    return [DefaultInfo(default_output = out)]


_sanitize_probe = rule(
    impl = _sanitize_probe_impl,
    attrs = {
        "value": attrs.string(),
        "out": attrs.string(),
    },
)


def sanitize_name_probe(name, value):
    # Helper used only in tests to materialize the sanitized form as an output filename
    _sanitize_probe(
        name = name,
        value = value,
        out = sanitize_name(value) + ".txt",
    )


__all__ = [
    "sanitize_name",
    "sanitize_name_probe",
]




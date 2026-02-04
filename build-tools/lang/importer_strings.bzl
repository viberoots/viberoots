load("//build-tools/lang:sanitize.bzl", "sanitize_name")

def sanitize_importer_for_nix_attr(importer: str) -> str:
    return sanitize_name(importer)

def importer_display_name(importer: str) -> str:
    parts = [p for p in importer.split("/") if p != ""]
    return parts[-1] if len(parts) > 0 else importer

# Test-only probe to materialize helper outputs.
def _importer_strings_probe_impl(ctx):
    importer = ctx.attrs.importer
    sanitized = sanitize_importer_for_nix_attr(importer)
    display = importer_display_name(importer)
    out = ctx.actions.declare_output(ctx.attrs.out)
    ctx.actions.write(out, sanitized + "\n" + display + "\n")
    return [DefaultInfo(default_output = out)]

_importer_strings_probe = rule(
    impl = _importer_strings_probe_impl,
    attrs = {
        "importer": attrs.string(),
        "out": attrs.string(),
    },
)

def importer_strings_probe(name, importer):
    _importer_strings_probe(
        name = name,
        importer = importer,
        out = name + ".txt",
    )

__all__ = [
    "sanitize_importer_for_nix_attr",
    "importer_display_name",
    "importer_strings_probe",
]



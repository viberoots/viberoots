def prepare_importer_non_genrule_nix_calling_wiring(*_args, **_kwargs):
    fail(
        "prepare_importer_non_genrule_nix_calling_wiring is internal-only. "
        + "Use //lang:language_wiring.bzl:prepare_language_wiring(...) at macro sites."
    )



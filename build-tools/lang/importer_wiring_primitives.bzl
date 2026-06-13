def _internal_only(name):
    fail(
        "%s is internal-only. Use @viberoots//build-tools/lang:language_wiring.bzl:prepare_language_wiring(...) at macro sites."
        % name
    )

def require_single_importer_lockfile_label(*_args, **_kwargs):
    _internal_only("require_single_importer_lockfile_label")

def attach_importer_patch_inputs(*_args, **_kwargs):
    _internal_only("attach_importer_patch_inputs")


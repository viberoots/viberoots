def _internal_only(name):
    fail(
        "%s is internal-only. Use //lang:language_wiring.bzl:prepare_language_wiring(...) at macro sites."
        % name
    )

def prepare_package_local_wiring(*_args, **_kwargs):
    _internal_only("prepare_package_local_wiring")

def package_local_wiring_probe(*_args, **_kwargs):
    _internal_only("package_local_wiring_probe")

def package_local_wiring_mutation_probe(*_args, **_kwargs):
    _internal_only("package_local_wiring_mutation_probe")



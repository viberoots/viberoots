def _internal_only(name):
    fail(
        "%s is internal-only. Use //build-tools/lang:language_wiring.bzl:prepare_language_wiring(...) at macro sites."
        % name
    )

def prepare_importer_genrule_kwargs(*_args, **_kwargs):
    _internal_only("prepare_importer_genrule_kwargs")

def prepare_importer_non_genrule_wiring(*_args, **_kwargs):
    _internal_only("prepare_importer_non_genrule_wiring")

def prepare_importer_srcsless_rule_wiring(*_args, **_kwargs):
    _internal_only("prepare_importer_srcsless_rule_wiring")
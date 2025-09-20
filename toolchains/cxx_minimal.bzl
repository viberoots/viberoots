def _noop_toolchain_impl(ctx):
    # Minimal no-op toolchain sufficient for tests that only require existence.
    return []

system_cxx_toolchain = rule(
    impl = _noop_toolchain_impl,
    attrs = {
        # Accept arbitrary attrs to mirror upstream signature loosely.
        "archiver": attrs.option(attrs.string(), default = None),
        "c_flags": attrs.list(attrs.arg(), default = []),
        "compiler": attrs.option(attrs.string(), default = None),
        "compiler_type": attrs.option(attrs.string(), default = None),
        "cvtres_compiler": attrs.option(attrs.string(), default = None),
        "cvtres_flags": attrs.list(attrs.arg(), default = []),
        "cxx_compiler": attrs.option(attrs.string(), default = None),
        "cxx_flags": attrs.list(attrs.arg(), default = []),
        "link_flags": attrs.list(attrs.arg(), default = []),
        "link_ordering": attrs.option(attrs.string(), default = None),
        "link_style": attrs.option(attrs.string(), default = None),
        "linker": attrs.option(attrs.string(), default = None),
        "post_link_flags": attrs.list(attrs.arg(), default = []),
        "rc_compiler": attrs.option(attrs.string(), default = None),
        "rc_flags": attrs.list(attrs.arg(), default = []),
        "_cxx_tools_info": attrs.option(attrs.dep(), default = None),
        "_internal_tools": attrs.option(attrs.dep(), default = None),
        "_target_os_type": attrs.option(attrs.string(), default = None),
    },
    is_toolchain_rule = True,
)



load("@prelude//toolchains:cxx.bzl", _prelude_system_cxx_toolchain = "system_cxx_toolchain")

def system_cxx_toolchain(**kwargs):
    # Ensure canonical toolchains cell label for clang tools to avoid crossing-cell defaults
    if "_cxx_tools_info" not in kwargs or not kwargs["_cxx_tools_info"]:
        kwargs["_cxx_tools_info"] = "toolchains//cxx/clang:path_clang_tools"
    return _prelude_system_cxx_toolchain(**kwargs)



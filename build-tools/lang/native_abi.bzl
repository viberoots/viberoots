def selected_native_target_triple():
    arch = host_info().arch
    if arch.is_aarch64:
        prefix = "aarch64"
    elif arch.is_x86_64:
        prefix = "x86_64"
    else:
        fail("native ABI: unsupported host architecture")

    os = host_info().os
    if os.is_macos:
        return prefix + "-apple-darwin"
    if os.is_linux:
        return prefix + "-unknown-linux-gnu"
    if os.is_windows and prefix == "x86_64":
        return "x86_64-pc-windows-msvc"
    fail("native ABI: unsupported host operating system")

SELECTED_LLVM_COMPILER = "selected-llvm"

__all__ = ["SELECTED_LLVM_COMPILER", "selected_native_target_triple"]

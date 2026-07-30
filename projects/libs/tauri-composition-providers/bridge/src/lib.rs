mod intrinsic_abi {
    extern "C" {
        pub fn composition_native_answer() -> i32;
    }
}

pub fn bridged_answer() -> i32 {
    unsafe { intrinsic_abi::composition_native_answer() }
}

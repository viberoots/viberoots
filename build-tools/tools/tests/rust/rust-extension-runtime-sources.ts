const runtimeLoaderSource = `
#[repr(C)]
struct DlInfo {
  dli_fname: *const c_char,
  dli_fbase: *mut c_void,
  dli_sname: *const c_char,
  dli_saddr: *mut c_void,
}
#[cfg(target_os = "linux")]
#[link(name = "dl")]
unsafe extern "C" {
  fn dlopen(filename: *const c_char, flags: c_int) -> *mut c_void;
  fn dlsym(handle: *mut c_void, symbol: *const c_char) -> *mut c_void;
  fn dladdr(address: *const c_void, info: *mut DlInfo) -> c_int;
}
#[cfg(not(target_os = "linux"))]
unsafe extern "C" {
  fn dlopen(filename: *const c_char, flags: c_int) -> *mut c_void;
  fn dlsym(handle: *mut c_void, symbol: *const c_char) -> *mut c_void;
  fn dladdr(address: *const c_void, info: *mut DlInfo) -> c_int;
}
unsafe fn c_answer() -> i32 {
  use std::ffi::{CStr, CString, OsStr};
  use std::os::unix::ffi::OsStrExt;
  let mut info = std::mem::MaybeUninit::<DlInfo>::zeroed();
  assert_ne!(
    dladdr(c_answer as *const () as *const c_void, info.as_mut_ptr()),
    0,
    "extension module path is required",
  );
  let module = CStr::from_ptr(info.assume_init().dli_fname);
  let module_path = std::path::Path::new(OsStr::from_bytes(module.to_bytes()));
  let library_name = if cfg!(target_os = "macos") {
    "libprojects-libs-extension-c-answer.dylib"
  } else {
    "libprojects-libs-extension-c-answer.so"
  };
  let library_path = module_path
    .parent()
    .expect("extension module directory is required")
    .join("runtime")
    .join(library_name);
  let library = CString::new(library_path.as_os_str().as_bytes()).expect("runtime path is valid");
  let handle = dlopen(library.as_ptr(), 2);
  assert!(!handle.is_null(), "staged native runtime library is required");
  let symbol = dlsym(handle, c"c_answer".as_ptr());
  assert!(!symbol.is_null(), "staged native runtime symbol is required");
  let answer: unsafe extern "C" fn() -> i32 = std::mem::transmute(symbol);
  answer()
}
`;

export const pythonSource = `use std::ffi::{c_char, c_int, c_void};
${runtimeLoaderSource}
#[repr(C)] struct PyObject { ob_refcnt: isize, ob_type: *mut c_void }
type PyFn = unsafe extern "C" fn(*mut PyObject, *mut PyObject) -> *mut PyObject;
#[repr(C)] struct PyMethodDef {
  ml_name: *const c_char, ml_meth: Option<PyFn>, ml_flags: c_int, ml_doc: *const c_char,
}
#[repr(C)] struct PyModuleDefBase {
  ob_base: PyObject, m_init: *mut c_void, m_index: isize, m_copy: *mut PyObject,
}
#[repr(C)] struct PyModuleDef {
  m_base: PyModuleDefBase, m_name: *const c_char, m_doc: *const c_char, m_size: isize,
  m_methods: *mut PyMethodDef, m_slots: *mut c_void, m_traverse: *mut c_void,
  m_clear: *mut c_void, m_free: *mut c_void,
}
unsafe impl Sync for PyMethodDef {}
unsafe impl Sync for PyModuleDef {}
unsafe extern "C" { fn PyLong_FromLong(v: i64) -> *mut PyObject;
  fn PyModule_Create2(d: *mut PyModuleDef, api: c_int) -> *mut PyObject;
  fn PyErr_SetString(kind: *mut PyObject, message: *const c_char);
  static mut PyExc_ValueError: *mut PyObject; }
unsafe extern "C" fn answer(_: *mut PyObject, _: *mut PyObject) -> *mut PyObject {
  PyLong_FromLong(c_answer() as i64)
}
unsafe extern "C" fn raise_error(_: *mut PyObject, _: *mut PyObject) -> *mut PyObject {
  PyErr_SetString(PyExc_ValueError, c"rust extension error".as_ptr()); std::ptr::null_mut()
}
static mut METHODS: [PyMethodDef; 3] = [
  PyMethodDef { ml_name: c"answer".as_ptr(), ml_meth: Some(answer), ml_flags: 4, ml_doc: c"answer".as_ptr() },
  PyMethodDef { ml_name: c"raise_error".as_ptr(), ml_meth: Some(raise_error), ml_flags: 4, ml_doc: c"error".as_ptr() },
  PyMethodDef { ml_name: std::ptr::null(), ml_meth: None, ml_flags: 0, ml_doc: std::ptr::null() },
];
static mut MODULE: PyModuleDef = PyModuleDef {
  m_base: PyModuleDefBase { ob_base: PyObject { ob_refcnt: 1, ob_type: std::ptr::null_mut() },
    m_init: std::ptr::null_mut(), m_index: 0, m_copy: std::ptr::null_mut() },
  m_name: c"_native".as_ptr(), m_doc: c"rust fixture".as_ptr(), m_size: -1,
  m_methods: &raw mut METHODS as *mut PyMethodDef, m_slots: std::ptr::null_mut(),
  m_traverse: std::ptr::null_mut(), m_clear: std::ptr::null_mut(), m_free: std::ptr::null_mut(),
};
#[no_mangle] pub unsafe extern "C" fn PyInit__native() -> *mut PyObject {
  PyModule_Create2(&raw mut MODULE, 1013)
}
`;

export const nodeSource = `use std::ffi::{c_char, c_int, c_void};
${runtimeLoaderSource}
type Env = *mut c_void; type Value = *mut c_void; type Info = *mut c_void;
type Callback = unsafe extern "C" fn(Env, Info) -> Value;
#[repr(C)] struct TypeTag { lower: u64, upper: u64 }
unsafe extern "C" { fn napi_create_int32(env: Env, value: i32, out: *mut Value) -> i32;
  fn napi_create_object(env: Env, out: *mut Value) -> i32;
  fn napi_type_tag_object(env: Env, value: Value, tag: *const TypeTag) -> i32;
  fn napi_check_object_type_tag(env: Env, value: Value, tag: *const TypeTag, out: *mut bool) -> i32;
  fn node_api_symbol_for(env: Env, description: *const c_char, length: usize, out: *mut Value) -> i32;
  fn napi_create_arraybuffer(env: Env, length: usize, data: *mut *mut c_void, out: *mut Value) -> i32;
  fn node_api_create_buffer_from_arraybuffer(env: Env, arraybuffer: Value, offset: usize,
    length: usize, out: *mut Value) -> i32;
  fn napi_create_function(env: Env, name: *const c_char, len: usize,
    callback: Option<Callback>, data: *mut c_void, out: *mut Value) -> i32;
  fn napi_set_named_property(env: Env, object: Value, name: *const c_char, value: Value) -> i32; }
unsafe extern "C" fn answer(env: Env, _: Info) -> Value {
  let mut out = std::ptr::null_mut(); assert_eq!(napi_create_int32(env, c_answer(), &mut out), 0); out
}
unsafe extern "C" fn napi_version(env: Env, _: Info) -> Value {
  let mut out = std::ptr::null_mut();
  let version = env!("NAPI_VERSION").parse::<i32>().expect("validated NAPI_VERSION");
  assert_eq!(napi_create_int32(env, version, &mut out), 0); out
}
unsafe extern "C" fn napi_conformance(env: Env, _: Info) -> Value {
  let version = env!("NAPI_VERSION").parse::<i32>().expect("validated NAPI_VERSION");
  #[cfg(feature = "napi8")] {
    let mut object = std::ptr::null_mut();
    let tag = TypeTag { lower: 0x1234, upper: 0x5678 };
    let mut matches = false;
    assert_eq!(napi_create_object(env, &mut object), 0);
    assert_eq!(napi_type_tag_object(env, object, &tag), 0);
    assert_eq!(napi_check_object_type_tag(env, object, &tag, &mut matches), 0);
    assert!(matches);
  }
  #[cfg(feature = "napi9")] {
    let mut symbol = std::ptr::null_mut();
    assert_eq!(node_api_symbol_for(env, c"viberoots".as_ptr(), 9, &mut symbol), 0);
    assert!(!symbol.is_null());
  }
  #[cfg(feature = "napi10")] {
    let mut data = std::ptr::null_mut();
    let mut arraybuffer = std::ptr::null_mut();
    let mut buffer = std::ptr::null_mut();
    assert_eq!(napi_create_arraybuffer(env, 4, &mut data, &mut arraybuffer), 0);
    assert_eq!(node_api_create_buffer_from_arraybuffer(env, arraybuffer, 0, 4, &mut buffer), 0);
    assert!(!buffer.is_null());
  }
  let mut out = std::ptr::null_mut();
  assert_eq!(napi_create_int32(env, version, &mut out), 0); out
}
#[cfg(feature = "napi_mismatch")]
#[no_mangle] pub extern "C" fn node_api_module_get_api_version_v1() -> i32 { 10 }
#[no_mangle] pub unsafe extern "C" fn napi_register_module_v1(env: Env, exports: Value) -> Value {
  let mut function = std::ptr::null_mut();
  assert_eq!(napi_create_function(env, c"answer".as_ptr(), usize::MAX,
    Some(answer), std::ptr::null_mut(), &mut function), 0);
  assert_eq!(napi_set_named_property(env, exports, c"answer".as_ptr(), function), 0);
  assert_eq!(napi_create_function(env, c"napiVersion".as_ptr(), usize::MAX,
    Some(napi_version), std::ptr::null_mut(), &mut function), 0);
  assert_eq!(napi_set_named_property(env, exports, c"napiVersion".as_ptr(), function), 0);
  assert_eq!(napi_create_function(env, c"napiConformance".as_ptr(), usize::MAX,
    Some(napi_conformance), std::ptr::null_mut(), &mut function), 0);
  assert_eq!(napi_set_named_property(env, exports, c"napiConformance".as_ptr(), function), 0); exports
}
`;

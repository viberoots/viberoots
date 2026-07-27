import * as fs from "node:fs/promises";
import path from "node:path";

const buildScript = `use std::{env, fs, path::Path};
fn main() {
  let paths = env::var("VIBEROOTS_RUST_LINK_LIBRARY_PATHS").expect("declared C libraries");
  for directory in env::split_paths(&paths) {
    if directory.as_os_str().is_empty() { continue; }
    println!("cargo:rustc-link-search=native={}", directory.display());
    let mut archives = fs::read_dir(&directory).into_iter().flatten().flatten()
      .map(|entry| entry.path()).collect::<Vec<_>>();
    archives.sort();
    for archive in archives {
      let extension = archive.extension().and_then(|v| v.to_str()).unwrap_or("");
      let stem = Path::new(&archive).file_stem().unwrap().to_str().unwrap();
      let name = stem.trim_start_matches("lib");
      if extension == "a" { println!("cargo:rustc-link-lib=static={name}"); }
      if extension == "so" || extension == "dylib" {
        println!("cargo:rustc-link-lib=dylib={name}");
      }
    }
  }
}
`;

const pythonSource = `use std::ffi::{c_char, c_int, c_void};
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
unsafe extern "C" { fn c_answer() -> i32; fn PyLong_FromLong(v: i64) -> *mut PyObject;
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

const nodeSource = `use std::ffi::{c_char, c_void};
type Env = *mut c_void; type Value = *mut c_void; type Info = *mut c_void;
type Callback = unsafe extern "C" fn(Env, Info) -> Value;
#[repr(C)] struct TypeTag { lower: u64, upper: u64 }
unsafe extern "C" { fn c_answer() -> i32;
  fn napi_create_int32(env: Env, value: i32, out: *mut Value) -> i32;
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

async function writeRustPackage(
  tmp: string,
  name: string,
  source: string,
  target: string,
  crateType = "cdylib",
): Promise<void> {
  const root = path.join(tmp, "projects/libs", name);
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  await fs.writeFile(
    path.join(root, "Cargo.toml"),
    `[package]\nname="${name}"\nversion="0.1.0"\nedition="2021"\nbuild="build.rs"\n\n[lib]\ncrate-type=["${crateType}"]\n`,
  );
  await fs.writeFile(
    path.join(root, "Cargo.lock"),
    `version = 3\n\n[[package]]\nname = "${name}"\nversion = "0.1.0"\n`,
  );
  await fs.writeFile(path.join(root, "build.rs"), buildScript);
  await fs.writeFile(path.join(root, "src/lib.rs"), source);
  await fs.writeFile(path.join(root, "TARGETS"), target);
}

export async function writeRustExtensionRuntimeFixture(tmp: string): Promise<void> {
  const baseRoot = path.join(tmp, "projects/libs/extension-base");
  await fs.mkdir(path.join(baseRoot, "src"), { recursive: true });
  await fs.writeFile(
    path.join(baseRoot, "src/base.cpp"),
    'extern "C" int c_base_answer() { return 40; }\n',
  );
  await fs.writeFile(
    path.join(baseRoot, "TARGETS"),
    'load("@viberoots//build-tools/cpp:defs.bzl", "nix_cpp_library")\nnix_cpp_library(name="base", srcs=["src/base.cpp"], link_mode="shared", visibility=["PUBLIC"])\n',
  );
  const cRoot = path.join(tmp, "projects/libs/extension-c");
  await fs.mkdir(path.join(cRoot, "src"), { recursive: true });
  await fs.writeFile(
    path.join(cRoot, "src/answer.cpp"),
    'extern "C" int c_base_answer();\nextern "C" int c_answer() { return c_base_answer() + 2; }\n',
  );
  await fs.writeFile(
    path.join(cRoot, "TARGETS"),
    'load("@viberoots//build-tools/cpp:defs.bzl", "nix_cpp_library")\nnix_cpp_library(name="answer", srcs=["src/answer.cpp"], link_mode="shared", link_deps=["//projects/libs/extension-base:base"], visibility=["PUBLIC"])\n',
  );
  await writeRustPackage(
    tmp,
    "rust_runtime_bundle",
    "pub fn runtime_marker() -> u8 { 1 }\n",
    'load("@viberoots//build-tools/rust:defs.bzl", "rust_library")\nrust_library(name="bundle", crate="rust_runtime_bundle", srcs=["build.rs", "src/lib.rs"], runtime_deps=["//projects/libs/extension-c:answer"], visibility=["PUBLIC"])\n',
    "rlib",
  );
  await writeRustPackage(
    tmp,
    "rust_pyext",
    pythonSource,
    [
      'load("@viberoots//build-tools/rust:defs.bzl", "rust_python_extension")',
      'rust_python_extension(name="extension", module="demo._native", crate="rust_pyext", srcs=["build.rs", "src/lib.rs"], link_deps=["//projects/libs/extension-c:answer"], runtime_deps=["//projects/libs/rust_runtime_bundle:bundle"], visibility=["PUBLIC"])',
      'rust_python_extension(name="bad_abi", module="demo._native", python_abi="cp00", crate="rust_pyext", srcs=["build.rs", "src/lib.rs"], link_deps=["//projects/libs/extension-c:answer"], runtime_deps=["//projects/libs/rust_runtime_bundle:bundle"])',
      "",
    ].join("\n"),
  );
  await writeRustPackage(
    tmp,
    "rust_addon",
    nodeSource,
    [
      'load("@viberoots//build-tools/rust:defs.bzl", "rust_node_addon")',
      'rust_node_addon(name="addon", addon_name="rust_native", node_api_version=8, crate="rust_addon", features=["napi8"], srcs=["build.rs", "src/lib.rs"], link_deps=["//projects/libs/extension-c:answer"], runtime_deps=["//projects/libs/rust_runtime_bundle:bundle"], visibility=["PUBLIC"])',
      'rust_node_addon(name="addon9", addon_name="rust_native9", node_api_version=9, crate="rust_addon", features=["napi9"], srcs=["build.rs", "src/lib.rs"], link_deps=["//projects/libs/extension-c:answer"], runtime_deps=["//projects/libs/rust_runtime_bundle:bundle"])',
      'rust_node_addon(name="addon10", addon_name="rust_native10", node_api_version=10, crate="rust_addon", features=["napi10"], srcs=["build.rs", "src/lib.rs"], link_deps=["//projects/libs/extension-c:answer"], runtime_deps=["//projects/libs/rust_runtime_bundle:bundle"])',
      'rust_node_addon(name="addon_mismatch", addon_name="rust_native_mismatch", node_api_version=8, crate="rust_addon", features=["napi8", "napi_mismatch"], srcs=["build.rs", "src/lib.rs"], link_deps=["//projects/libs/extension-c:answer"], runtime_deps=["//projects/libs/rust_runtime_bundle:bundle"])',
      "",
    ].join("\n"),
  );
  await fs.appendFile(
    path.join(tmp, "projects/libs/rust_addon/Cargo.toml"),
    "\n[features]\nnapi8 = []\nnapi9 = []\nnapi10 = []\nnapi_mismatch = []\n",
  );
}

export async function writeCombinedRustExtensionPackage(tmp: string): Promise<void> {
  await writeRustExtensionRuntimeFixture(tmp);
  const source = `#[cfg(feature = "python")]\nmod python {\n${pythonSource}\n}\n#[cfg(feature = "node")]\nmod node {\n${nodeSource}\n}\n`;
  await writeRustPackage(
    tmp,
    "rust_extensions",
    source,
    [
      'load("@viberoots//build-tools/rust:defs.bzl", "rust_node_addon", "rust_python_extension")',
      'rust_python_extension(name="extension", module="demo._native", crate="rust_extensions", features=["python"], srcs=["build.rs", "src/lib.rs"], link_deps=["//projects/libs/extension-c:answer"], runtime_deps=["//projects/libs/rust_runtime_bundle:bundle"], visibility=["PUBLIC"])',
      'rust_node_addon(name="addon", addon_name="rust_native", node_api_version=8, crate="rust_extensions", features=["node", "napi8"], srcs=["build.rs", "src/lib.rs"], link_deps=["//projects/libs/extension-c:answer"], runtime_deps=["//projects/libs/rust_runtime_bundle:bundle"], visibility=["PUBLIC"])',
      "",
    ].join("\n"),
  );
  await fs.appendFile(
    path.join(tmp, "projects/libs/rust_extensions/Cargo.toml"),
    "\n[features]\npython = []\nnode = []\nnapi8 = []\n",
  );
}

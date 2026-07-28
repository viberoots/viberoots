{
  labelPriorityPre = [
    { label = "kind:addon"; kind = "addon"; }
    { label = "kind:pyext_wasm"; kind = "pyext_wasm"; }
    { label = "kind:pyext"; kind = "pyext"; }
    { label = "kind:test"; kind = "test"; }
    { label = "kind:wasi"; kind = "wasi"; }
    { label = "kind:wasi_static"; kind = "wasi_static"; }
    { label = "wasm:component"; kind = "wasm_component"; }
    { label = "wasm:browser"; kind = "wasm_browser"; }
    { label = "wasm:static"; kind = "wasm_static"; }
    { label = "kind:wasm"; kind = "wasm"; }
    { label = "kind:bin"; kind = "bin"; }
    { label = "kind:lib"; kind = "lib"; }
  ];
  ruleTypes.suffixes = [
    { suffix = "_node_addon"; kind = "addon"; }
    { suffix = "_python_wasm_extension"; kind = "pyext_wasm"; }
    { suffix = "_python_extension"; kind = "pyext"; }
    { suffix = "_wasi_binary"; kind = "wasi"; }
    { suffix = "_wasm_component"; kind = "wasm_component"; }
    { suffix = "_wasm_browser_package"; kind = "wasm_browser"; }
    { suffix = "_wasm_static_library"; kind = "wasm_static"; }
    { suffix = "_wasm_library"; kind = "wasm"; }
    { suffix = "_test"; kind = "test"; }
    { suffix = "_binary"; kind = "bin"; }
    { suffix = "_library"; kind = "lib"; }
  ];
}

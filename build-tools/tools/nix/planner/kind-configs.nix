{
  go = {
    labelPriorityPre = [
      { label = "kind:bin"; kind = "bin"; }
      { label = "kind:carchive"; kind = "carchive"; }
      { label = "kind:wasm"; kind = "tinywasm"; }
      { label = "kind:test"; kind = "test"; }
    ];
    ruleTypes = {
      suffixes = [
        { suffix = "_binary"; kind = "bin"; }
        { suffix = "_test"; kind = "test"; }
      ];
      prefixes = [ { prefix = "go_"; kind = "lib"; } ];
    };
    labelPriorityPost = [ { label = "kind:bin"; kind = "bin"; } ];
    defaultKind = "lib";
  };
  cpp = {
    plannerStubs = [ { nameSuffix = "__planner"; kind = "test"; } ];
    labelPriorityPre = [
      { label = "kind:test"; kind = "test"; }
      { label = "kind:bin"; kind = "bin"; }
      { label = "kind:headers"; kind = "headers"; }
      { label = "kind:lib"; kind = "lib"; }
      { label = "kind:addon"; kind = "addon"; }
    ];
    ruleTypes = {
      equals = [
        { ruleType = "cxx_test"; kind = "test"; }
        { ruleType = "cxx_binary"; kind = "bin"; }
        { ruleType = "cxx_library"; kind = "lib"; }
      ];
    };
  };
  python = {
    labelPriorityPre = [
      { label = "kind:wasm"; kind = "wasm"; }
      { label = "kind:pyext_wasm"; kind = "pyext_wasm"; }
      { label = "kind:pyext"; kind = "pyext"; }
      { label = "kind:test"; kind = "test"; }
    ];
    ruleTypes = {
      suffixes = [
        { suffix = "_binary"; kind = "bin"; }
        { suffix = "_test"; kind = "test"; }
      ];
    };
    labelPriorityPost = [ { label = "kind:bin"; kind = "bin"; } ];
    defaultKind = "lib";
  };
  node = {
    labelPriorityPre = [
      { label = "kind:gen"; kind = "gen"; }
      { label = "kind:bin"; kind = "bin"; }
      { label = "kind:lib"; kind = "lib"; }
    ];
  };
}

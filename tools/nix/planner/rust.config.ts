export default {
  id: "rust",
  detect: {
    ruleTypePrefixes: ["rust_"],
    requireAnyLabels: ["lang:rust"],
  },
  kindRules: [
    { ifHasAnyLabel: ["kind:bin"], thenKind: "bin" },
    { ifHasAnyLabel: ["kind:lib"], thenKind: "lib" },
  ],
  modulesFile: { inheritFromGo: true },
  builders: {
    mkApp: {
      expr: "T.goApp",
      args: [
        "{ inherit name; modulesToml = modulesTomlFor name; repoRoot = repoRoot; subdir = (pkgPathOf name); }",
      ],
    },
    mkLib: {
      expr: "T.goLib",
      args: [
        "{ inherit name; modulesToml = modulesTomlFor name; repoRoot = repoRoot; subdir = (pkgPathOf name); }",
      ],
    },
  },
};

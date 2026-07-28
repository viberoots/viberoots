export const rustPkgsExpression = `
  let
    base = import <nixpkgs> {};
    toolchain = base.symlinkJoin {
      name = "viberoots-test-rust-toolchain";
      paths = [ base.cargo base.rustc ];
    };
  in base // {
    viberootsRustToolchain = toolchain;
    viberootsRustPlatform = base.rustPlatform;
  }
`;

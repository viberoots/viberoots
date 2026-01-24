## C++ planner refactor plan

I am splitting `tools/nix/planner/cpp.nix` into smaller modules to stay under the 250 line limit.
I move dependency resolution (`repoCppLibPkgsFor`, `repoCppHeaderPkgsFor`, nix attr collection) into `tools/nix/planner/cpp-deps.nix`.
I move target construction (`mkApp`, `mkLib`, `mkHeaders`, `mkTest`, `mkAddon`) into `tools/nix/planner/cpp-targets.nix`.
I keep the public entrypoint in `tools/nix/planner/cpp.nix` and remove the relocated function bodies once wired.

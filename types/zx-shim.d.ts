// Minimal shims so zx TS scripts lint cleanly without depending on @types/node at lint time.
// These shims are intentionally loose and only used during type checking.

declare module "node:*" {
  const anyModule: any;
  export = anyModule;
}

declare var process: any;
declare var console: any;

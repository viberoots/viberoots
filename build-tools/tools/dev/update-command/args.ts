export type UpdateCommandArgs = {
  upgrade: boolean;
  verbose: boolean;
};

export const UPDATE_COMMAND_HELP = `usage: u [--upgrade] [--verbose]

Make project dependency and generated metadata consistent after source edits.

  u            conservatively repair locks and deterministic metadata
  u --upgrade  intentionally upgrade pnpm, Go, Python, and Cargo dependencies

C++ has no upgradeable dependency authority and is reconciled without moving Nix pins. Cargo
resolution is always offline and uses the reviewed Nix-store Cargo executable.
Language operations time out after 600 seconds by default. Set
VBR_UPDATE_LANGUAGE_TIMEOUT_SECONDS to a positive value up to 3600 to override it.
Neither mode updates the viberoots pin, submodule, or flake input.
Use viberoots update when the viberoots pin itself should move.

options:
  --upgrade    intentionally upgrade supported project dependency versions
  --verbose    show each reconciliation step
  -h, --help   show help

After the command completes, run: i && b && v`;

export function parseUpdateCommandArgs(argv: string[]): UpdateCommandArgs | "help" {
  let upgrade = false;
  let verbose = false;
  for (const arg of argv) {
    if (arg === "-h" || arg === "--help") return "help";
    if (arg === "--upgrade") upgrade = true;
    else if (arg === "--verbose" || arg === "-v") verbose = true;
    else throw new Error(`unknown argument: ${arg}\nrun: u --help`);
  }
  return { upgrade, verbose };
}

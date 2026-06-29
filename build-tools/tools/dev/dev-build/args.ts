import { readFlagBoolFromTokens, removeKnownFlags } from "../../lib/cli";

export type DevBuildArgs = {
  subcmd: string;
  restArgs: string[];
  materialize: boolean;
  impure: boolean;
};

const KNOWN_SUBCMDS = new Set([
  "build",
  "test",
  "run",
  "cquery",
  "query",
  "install",
  "kill",
  "server",
  "clean",
]);

function isBuckTargetToken(tok: string): boolean {
  return /^(?:\/\/|root\/\/|:)/.test(tok);
}

function stripDevBuildFlags(args: string[]): {
  args: string[];
  materialize: boolean;
  impure: boolean;
} {
  const { argv: cleaned } = removeKnownFlags(args, {
    presence: ["--impure", "--no-materialize"],
    takesValue: [],
  });
  const impure = readFlagBoolFromTokens("impure", args);
  const materialize = !readFlagBoolFromTokens("no-materialize", args);
  return { args: cleaned, materialize, impure };
}

export function parseDevBuildArgs(argsIn: string[]): DevBuildArgs {
  let subcmd = "build";
  let restArgs = argsIn;

  if (argsIn.length === 0) {
    restArgs = [];
  } else if (KNOWN_SUBCMDS.has(argsIn[0] || "")) {
    subcmd = argsIn[0] as string;
    restArgs = argsIn.slice(1);
  } else if (isBuckTargetToken(argsIn[0] || "")) {
    subcmd = "build";
    restArgs = argsIn;
  } else {
    subcmd = "build";
    restArgs = argsIn;
  }

  const stripped = stripDevBuildFlags(restArgs);
  restArgs = stripped.args;
  let materialize = stripped.materialize;
  let impure = stripped.impure;

  // Allow command after flags: build-tools/tools/dev/dev-build.ts --impure build //...
  if (restArgs.length > 0 && KNOWN_SUBCMDS.has(restArgs[0] || "")) {
    subcmd = restArgs[0] as string;
    restArgs = restArgs.slice(1);
  }

  if (subcmd === "build" && restArgs.length === 0) {
    restArgs = ["//..."];
  }

  return { subcmd, restArgs, materialize, impure };
}

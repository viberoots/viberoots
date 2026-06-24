import { shSingleQuote } from "../lib/shell-quote";

export function commandArgs(args: Array<[string, string]>): string {
  return args.map(([flag, value]) => `--${flag} ${shSingleQuote(value)}`).join(" ");
}

export function commandListArgs(flag: string, values: string[]): string {
  return values.map((value) => `--${flag} ${shSingleQuote(value)}`).join(" ");
}

export function remoteBashCommand(script: string): string {
  return `bash -lc ${shSingleQuote(script)}`;
}

function remoteToolBinSetup(opts: {
  repoExpr: string;
  varName: string;
  relativePath: string;
  description: string;
}): string[] {
  return [
    `${opts.varName}=""`,
    `for candidate in ${opts.repoExpr}/${opts.relativePath} ${opts.repoExpr}/viberoots/${opts.relativePath} ${opts.repoExpr}/.viberoots/current/${opts.relativePath}; do if [ -e "$candidate" ]; then ${opts.varName}="$candidate"; break; fi; done`,
    `if [ -z "$${opts.varName}" ]; then echo "reviewed remote repo checkout is unusable (missing active viberoots ${opts.description}): $repo" >&2; exit 1; fi`,
  ];
}

export function remoteDeployBinSetup(repoExpr: string): string[] {
  return remoteToolBinSetup({
    repoExpr,
    varName: "deploy_bin",
    relativePath: "build-tools/tools/bin/deploy",
    description: "deploy tool",
  });
}

export function remoteHostApplyBinSetup(repoExpr: string): string[] {
  return remoteToolBinSetup({
    repoExpr,
    varName: "host_apply_bin",
    relativePath: "build-tools/tools/deployments/nixos-shared-host-host-apply.ts",
    description: "host apply tool",
  });
}

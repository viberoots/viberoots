export const consumerGitignoreEntries = [
  ".viberoots/",
  "buck-out/",
  ".direnv/",
  ".nix-zsh/",
  ".nix-gcroots/",
  "node_modules",
  "node_modules/",
  "projects/config/local.json",
  ".local/",
] as const;

export const requiredConsumerTrackedPaths = [
  ".buckroot",
  ".buckconfig",
  ".envrc",
  ".gitignore",
] as const;

export const guardedConsumerTrackedPaths = [
  ...requiredConsumerTrackedPaths,
  "projects/config/local.json",
] as const;

export type GuardedConsumerTrackedPath = (typeof guardedConsumerTrackedPaths)[number];

export function missingConsumerGitignoreEntries(current: string): string[] {
  const existing = new Set(
    current
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean),
  );
  return consumerGitignoreEntries.filter((entry) => !existing.has(entry));
}

export function staleConsumerTrackedInput(opts: {
  tracked: Partial<Record<GuardedConsumerTrackedPath, string>>;
  expectedBuckconfig: string;
  expectedEnvrc: string;
}): GuardedConsumerTrackedPath | undefined {
  const expected = new Map<GuardedConsumerTrackedPath, string>([
    [".buckroot", ".\n"],
    [".buckconfig", opts.expectedBuckconfig],
    [".envrc", opts.expectedEnvrc],
  ]);
  for (const [rel, content] of expected) {
    if (opts.tracked[rel] !== content) return rel;
  }
  if (
    opts.tracked[".gitignore"] === undefined ||
    missingConsumerGitignoreEntries(opts.tracked[".gitignore"]).length > 0
  ) {
    return ".gitignore";
  }
  if (opts.tracked["projects/config/local.json"] !== undefined) {
    return "projects/config/local.json";
  }
  return undefined;
}

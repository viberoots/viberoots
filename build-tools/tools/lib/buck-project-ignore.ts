export const BUCK_PROJECT_IGNORES = [
  ".git",
  ".direnv",
  ".viberoots/buck",
  ".viberoots/buck/tmp",
  ".viberoots/workspace/buck/tmp",
  ".viberoots/workspace/viberoots-flake-input",
  ".claude/worktrees",
  ".codex/worktrees",
] as const;

export const BUCK_PROJECT_IGNORE_LINE = `ignore = ${BUCK_PROJECT_IGNORES.join(", ")}`;

export function withBuckProjectIgnorePolicy(config: string): string {
  const lines = config.split("\n");
  const projectIndex = lines.findIndex((line) => line.trim() === "[project]");
  if (projectIndex < 0) {
    return `${config.replace(/\n*$/, "\n\n")}[project]\n${BUCK_PROJECT_IGNORE_LINE}\n`;
  }

  let insertAt = lines.length;
  for (let i = projectIndex + 1; i < lines.length; i += 1) {
    if (/^\[[^\]]+\]\s*$/.test(lines[i])) {
      insertAt = i;
      break;
    }
    if (/^\s*ignore\s*=/.test(lines[i])) {
      lines[i] = BUCK_PROJECT_IGNORE_LINE;
      return lines.join("\n");
    }
  }

  lines.splice(insertAt, 0, BUCK_PROJECT_IGNORE_LINE);
  return lines.join("\n");
}

import { promptTerminalLine } from "../../lib/terminal-select";

export function isInteractive(): boolean {
  return (
    process.env.VBR_CODEX_NONINTERACTIVE !== "1" &&
    Boolean(process.stdin.isTTY) &&
    Boolean(process.stdout.isTTY)
  );
}

export async function confirm(question: string): Promise<boolean> {
  const answer = await promptTerminalLine(question.trimEnd());
  return /^(y|yes)$/i.test(answer);
}

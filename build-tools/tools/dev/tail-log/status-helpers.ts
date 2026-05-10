import { execFileSync } from "node:child_process";
import { processCommandLinesSync } from "../../lib/process-inspection";
import { resolveToolPathSync } from "../../lib/tool-paths";

export function getExtraStatusLines(isTty: boolean): string {
  const commands = getProcessCommands();
  const buckCount = getBuckProcessCount(commands);
  const nodeCount = getNodeProcessCount(commands);
  const viteCount = getViteNonNodeProcessCount(commands);
  const nextCount = getNextNonNodeProcessCount(commands);
  const diskUsage = getDiskUsage();
  const DIM = "\u001b[2m";
  const RESET = "\u001b[0m";
  const label = (s: string) => (isTty ? `${DIM}${s}${RESET}` : s);
  const targetCol = "Time elapsed:".length + 4;
  const padFor = (plainLabel: string) => {
    const padLen = Math.max(1, targetCol - plainLabel.length);
    return " ".repeat(padLen);
  };
  const buckLabel = "Buck processes:";
  const nodeLabel = "Node processes:";
  const viteLabel = "Vite processes:";
  const nextLabel = "Next processes:";
  const diskLabel = "Disk usage:";
  return (
    `${label(buckLabel)}${padFor(buckLabel)}${buckCount}\n` +
    `${label(nodeLabel)}${padFor(nodeLabel)}${nodeCount}\n` +
    `${label(viteLabel)}${padFor(viteLabel)}${viteCount}\n` +
    `${label(nextLabel)}${padFor(nextLabel)}${nextCount}\n` +
    `${label(diskLabel)}${padFor(diskLabel)}${diskUsage}`
  );
}

export function clearScreen(): string {
  return "\u001b[2J\u001b[3J\u001b[H";
}

export function trimToTerminal(text: string, columns: number | undefined): string[] {
  const lines = text.split("\n");
  if (!columns || columns <= 0) return lines;
  return lines.map((line) => truncateAnsi(line, columns));
}

function truncateAnsi(input: string, maxVisible: number): string {
  if (maxVisible <= 0) return "";
  const ansi = /\u001b\[[0-9;]*m/g;
  const hasAnsi = /\u001b\[[0-9;]*m/.test(input);
  const plainLen = input.replace(ansi, "").length;
  if (plainLen <= maxVisible) return input;
  let visible = 0;
  let i = 0;
  let out = "";
  while (i < input.length && visible < maxVisible) {
    if (input[i] === "\u001b" && input[i + 1] === "[") {
      const end = input.indexOf("m", i + 2);
      if (end !== -1) {
        out += input.slice(i, end + 1);
        i = end + 1;
        continue;
      }
    }
    out += input[i];
    visible += 1;
    i += 1;
  }
  return hasAnsi ? out + "\u001b[0m" : out;
}

function getProcessCommands(): string[] {
  return processCommandLinesSync({
    pgrepPattern:
      "buck2d\\[|\\(buck2-forkserver\\)|(^|/)buck2( |$)|(^|/)node(js)?( |$)|(^|/)vite( |$)|(^|/)next( |$)",
  });
}

function getBuckProcessCount(commands: string[]): number {
  return commands.filter((cmd) => {
    if (cmd.includes("buck2d[")) return true;
    if (cmd.includes("(buck2-forkserver)")) return true;
    return /(^|\s)buck2(\s|$)/.test(cmd);
  }).length;
}

function getNodeProcessCount(commands: string[]): number {
  return commands.filter(isNodeProcess).length;
}

function getViteNonNodeProcessCount(commands: string[]): number {
  return commands.filter((cmd) => {
    if (isNodeProcess(cmd)) return false;
    return /(^|[\s/])vite(\s|$)/.test(cmd);
  }).length;
}

function getNextNonNodeProcessCount(commands: string[]): number {
  return commands.filter((cmd) => {
    if (isNodeProcess(cmd)) return false;
    return /(^|[\s/])next(\s|$)/.test(cmd);
  }).length;
}

function isNodeProcess(command: string): boolean {
  return /(^|[\s/])node(\s|$)/.test(command) || /(^|[\s/])nodejs(\s|$)/.test(command);
}

function getDiskUsage(): string {
  try {
    const out = execFileSync(resolveToolPathSync("df"), ["-kP", process.cwd()], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return formatDiskUsageFromDfOutput(out) ?? "Unknown";
  } catch {
    return "Unknown";
  }
}

export function formatDiskUsageFromDfOutput(output: string): string | null {
  const lines = String(output || "")
    .trim()
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) return null;
  const fields = lines[1].split(/\s+/);
  const totalKiB = Number(fields[1]);
  const availKiB = Number(fields[3]);
  const capacity = fields[4] || "?";
  if (!Number.isFinite(totalKiB) || !Number.isFinite(availKiB)) return null;
  return `${formatKiB(availKiB)} free, ${formatKiB(totalKiB)} total, ${capacity} full`;
}

function formatKiB(kib: number): string {
  if (kib <= 0) return "0KiB";
  const units = ["KiB", "MiB", "GiB", "TiB"];
  let value = kib;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = value >= 10 || unit === 0 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded}${units[unit]}`;
}

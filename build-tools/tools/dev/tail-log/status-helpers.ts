import { execFileSync } from "node:child_process";
import { resolveToolPathSync } from "../../lib/tool-paths.ts";

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
  try {
    const out = execFileSync(resolveToolPathSync("ps"), ["-A", "-o", "command="], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return String(out || "")
      .split("\n")
      .map((x) => x.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
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
    const out = execFileSync("df", ["-h", "/System/Volumes/Data"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
      .trim()
      .split("\n");
    if (out.length < 2) return "Unknown";
    const fields = out[1].trim().split(/\s+/);
    const size = fields[1] || "?";
    const avail = fields[3] || "?";
    const capacity = fields[4] || "?";
    return `${avail} free, ${size} total, ${capacity} full`;
  } catch {
    return "Unknown";
  }
}

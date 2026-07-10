import * as fs from "node:fs";
import * as readline from "node:readline/promises";
import * as tty from "node:tty";

export type TerminalSelectChoice = {
  label: string;
  value: string;
  valueLabel?: string | false;
};

export type TerminalPromptStreams = {
  input: NodeJS.ReadableStream & {
    isTTY?: boolean;
    isRaw?: boolean;
    setRawMode?: (mode: boolean) => unknown;
  };
  output: NodeJS.WritableStream & { columns?: number };
  close: () => void;
};

export async function promptTerminalSelect(
  message: string,
  choices: TerminalSelectChoice[],
  initialIndex: number,
  opts: { cancelMessage?: string; streams?: TerminalPromptStreams } = {},
) {
  if (choices.length === 0) throw new Error(`${message} has no choices`);
  const streams = opts.streams || promptTtyStreams();
  if (!streams.input.isTTY) return await promptSelectLine(message, choices, initialIndex);
  let index = Math.max(0, Math.min(initialIndex, choices.length - 1));
  let rendered = false;
  let renderedChoiceRows = choices.length;
  const terminalColumns = () =>
    typeof streams.output.columns === "number" && streams.output.columns > 0
      ? streams.output.columns
      : undefined;
  const renderedRows = (text: string) => {
    const columns = terminalColumns();
    return columns ? Math.max(1, Math.ceil(text.length / columns)) : 1;
  };
  const render = () => {
    if (!rendered) {
      streams.output.write(`${message}:  Up/Down then Enter\n`);
      rendered = true;
    } else {
      streams.output.write(`\x1b[${renderedChoiceRows}A`);
    }
    let nextRenderedChoiceRows = 0;
    choices.forEach((choice, idx) => {
      const selected = idx === index;
      const valueLabel = choice.valueLabel === undefined ? choice.value : choice.valueLabel;
      const line = `${selected ? ">" : " "} ${choice.label}${valueLabel === false ? "" : ` (${valueLabel})`}`;
      nextRenderedChoiceRows += renderedRows(line);
      streams.output.write(`\r\x1b[K${line}\n`);
    });
    renderedChoiceRows = nextRenderedChoiceRows;
  };
  const previousRaw = Boolean(streams.input.isRaw);
  if (typeof streams.input.setRawMode !== "function") {
    return await promptSelectLine(message, choices, initialIndex);
  }
  let onData: ((chunk: Buffer) => void) | undefined;
  try {
    const selected = new Promise<string>((resolve, reject) => {
      let pending = "";
      let settled = false;
      const finish = (value: string) => {
        if (settled) return;
        settled = true;
        streams.output.write("\n");
        resolve(value);
      };
      const cancel = () => {
        if (settled) return;
        settled = true;
        streams.output.write("\n");
        reject(new Error(opts.cancelMessage || `${message} cancelled`));
      };
      const move = (offset: number) => {
        index = (index + choices.length + offset) % choices.length;
        render();
      };
      onData = (chunk: Buffer) => {
        pending += chunk.toString("utf8");
        while (pending.length > 0) {
          if (pending.includes("\u0003")) {
            cancel();
            return;
          }
          const enterIndex = pending.search(/[\r\n]/);
          const escapeIndex = pending.indexOf("\u001b");
          if (enterIndex !== -1 && (escapeIndex === -1 || enterIndex < escapeIndex)) {
            finish(choices[index]?.value || choices[0]!.value);
            return;
          }
          if (pending[0] !== "\u001b") {
            pending = pending.slice(1);
            continue;
          }
          if (pending === "\u001b" || pending === "\u001b[" || pending === "\u001bO") return;
          if (pending.startsWith("\u001b[A") || pending.startsWith("\u001bOA")) {
            pending = pending.slice(3);
            move(-1);
            continue;
          }
          if (pending.startsWith("\u001b[B") || pending.startsWith("\u001bOB")) {
            pending = pending.slice(3);
            move(1);
            continue;
          }
          if (/^\u001b\[[0-9;]*[~A-Za-z]/.test(pending)) {
            pending = pending.replace(/^\u001b\[[0-9;]*[~A-Za-z]/, "");
            continue;
          }
          pending = pending.slice(1);
        }
      };
      streams.input.on("data", onData);
    });
    streams.input.setRawMode(true);
    streams.input.resume();
    render();
    return await selected;
  } finally {
    if (onData) streams.input.off("data", onData);
    streams.input.setRawMode(previousRaw);
    pausePromptInput(streams.input);
    streams.close();
  }
}

export async function promptTerminalLine(message: string, defaultValue = "") {
  const streams = promptStreams();
  const rl = readline.createInterface({ input: streams.input, output: streams.output });
  try {
    const suffix = defaultValue ? ` [${defaultValue}]` : "";
    return (await rl.question(`${message}${suffix}: `)).trim() || defaultValue;
  } finally {
    rl.close();
    pausePromptInput(streams.input);
    streams.close();
  }
}

export function hasControllingTerminal() {
  if (process.platform === "win32") return false;
  let fd: number | undefined;
  try {
    fd = fs.openSync("/dev/tty", "r+");
    return true;
  } catch {
    return false;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

async function promptSelectLine(
  message: string,
  choices: TerminalSelectChoice[],
  initialIndex: number,
) {
  const streams = promptStreams();
  const rl = readline.createInterface({ input: streams.input, output: streams.output });
  try {
    streams.output.write(`${message}:\n`);
    choices.forEach((choice, idx) => {
      const valueLabel = choice.valueLabel === undefined ? choice.value : choice.valueLabel;
      streams.output.write(
        `  ${idx + 1}. ${choice.label}${valueLabel === false ? "" : ` (${valueLabel})`}\n`,
      );
    });
    const answer = (await rl.question(`Choose [${initialIndex + 1}]: `)).trim();
    const parsed = Number(answer || initialIndex + 1);
    return choices[parsed - 1]?.value || choices[initialIndex]?.value || choices[0]!.value;
  } finally {
    rl.close();
    pausePromptInput(streams.input);
    streams.close();
  }
}

type PromptStreams = TerminalPromptStreams;

function promptStreams(): PromptStreams {
  return (
    openTtyStreams() || { input: process.stdin, output: process.stderr, close: () => undefined }
  );
}

function promptTtyStreams() {
  const streams = openTtyStreams();
  if (streams) return streams as PromptStreams & { input: tty.ReadStream; output: tty.WriteStream };
  return {
    input: process.stdin as tty.ReadStream,
    output: process.stderr as tty.WriteStream,
    close: () => undefined,
  };
}

function openTtyStreams(): PromptStreams | undefined {
  let inputFd: number | undefined;
  let outputFd: number | undefined;
  try {
    inputFd = fs.openSync("/dev/tty", "r");
    outputFd = fs.openSync("/dev/tty", "w");
    const input = new tty.ReadStream(inputFd);
    const output = new tty.WriteStream(outputFd);
    return {
      input,
      output,
      close: () => {
        closePromptStream(input);
        closePromptStream(output);
      },
    };
  } catch {
    if (inputFd !== undefined) fs.closeSync(inputFd);
    if (outputFd !== undefined) fs.closeSync(outputFd);
    return undefined;
  }
}

function pausePromptInput(input: NodeJS.ReadableStream) {
  if (typeof input.pause === "function") input.pause();
}

function closePromptStream(stream: NodeJS.ReadableStream | NodeJS.WritableStream) {
  const close = (stream as { close?: () => void }).close;
  if (typeof close === "function") close.call(stream);
  else if (typeof stream.destroy === "function") stream.destroy();
}

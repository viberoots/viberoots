import * as fs from "node:fs";
import * as readline from "node:readline/promises";
import * as tty from "node:tty";

export type TerminalSelectChoice = {
  label: string;
  value: string;
  valueLabel?: string | false;
};

export async function promptTerminalSelect(
  message: string,
  choices: TerminalSelectChoice[],
  initialIndex: number,
  opts: { cancelMessage?: string } = {},
) {
  if (choices.length === 0) throw new Error(`${message} has no choices`);
  const streams = promptTtyStreams();
  if (!streams.input.isTTY) return await promptSelectLine(message, choices, initialIndex);
  let index = Math.max(0, Math.min(initialIndex, choices.length - 1));
  let rendered = false;
  const render = () => {
    if (!rendered) {
      streams.output.write(`${message}:\n`);
      rendered = true;
    } else {
      streams.output.write(`\x1b[${choices.length}A`);
    }
    choices.forEach((choice, idx) => {
      const selected = idx === index;
      const valueLabel = choice.valueLabel === undefined ? choice.value : choice.valueLabel;
      streams.output.write(
        `\r\x1b[K${selected ? ">" : " "} ${choice.label}${valueLabel === false ? "" : ` (${valueLabel})`}${
          selected ? "  Up/Down then Enter" : ""
        }\n`,
      );
    });
  };
  const previousRaw = streams.input.isRaw;
  streams.input.setRawMode(true);
  streams.input.resume();
  render();
  let onData: ((chunk: Buffer) => void) | undefined;
  try {
    return await new Promise<string>((resolve, reject) => {
      onData = (chunk: Buffer) => {
        const text = chunk.toString("utf8");
        if (text.includes("\u0003")) {
          streams.output.write("\n");
          reject(new Error(opts.cancelMessage || `${message} cancelled`));
          return;
        }
        if (/[\r\n]/.test(text)) {
          streams.output.write("\n");
          resolve(choices[index]?.value || choices[0]!.value);
          return;
        }
        let changed = false;
        if (text.includes("\u001b[A")) {
          index = (index + choices.length - 1) % choices.length;
          changed = true;
        }
        if (text.includes("\u001b[B")) {
          index = (index + 1) % choices.length;
          changed = true;
        }
        if (changed) render();
      };
      streams.input.on("data", onData);
    });
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

type PromptStreams = {
  input: NodeJS.ReadableStream;
  output: NodeJS.WritableStream;
  close: () => void;
};

function promptStreams(): PromptStreams {
  try {
    const input = fs.createReadStream("/dev/tty");
    const output = fs.createWriteStream("/dev/tty");
    return {
      input,
      output,
      close: () => {
        input.destroy();
        output.end();
      },
    };
  } catch {
    return { input: process.stdin, output: process.stderr, close: () => undefined };
  }
}

function promptTtyStreams() {
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
        input.destroy();
        output.end();
      },
    };
  } catch {
    if (inputFd !== undefined) fs.closeSync(inputFd);
    if (outputFd !== undefined) fs.closeSync(outputFd);
    return {
      input: process.stdin as tty.ReadStream,
      output: process.stderr as tty.WriteStream,
      close: () => undefined,
    };
  }
}

function pausePromptInput(input: NodeJS.ReadableStream) {
  if (typeof input.pause === "function") input.pause();
}

#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { PassThrough, Writable } from "node:stream";
import { test } from "node:test";
import { promptTerminalSelect } from "../../lib/terminal-select";

test("terminal selector pauses stdin after selection", async () => {
  const input = new FakeTtyInput();
  const output = new CaptureOutput();
  try {
    const selected = promptTerminalSelect(
      "Select item",
      [
        { label: "First", value: "first" },
        { label: "Second", value: "second" },
      ],
      0,
      { streams: { input, output, close: () => undefined } },
    );
    input.write("\u001b[B");
    input.write("\r\n");
    assert.equal(await selected, "second");
    assert.equal(input.rawMode, false);
    assert.equal(input.paused, true);
  } finally {
    input.destroy();
  }
});

test("terminal selector accepts enter typed during initial render", async () => {
  const input = new FakeTtyInput();
  const output = new CaptureOutput(() => input.write("\r"));
  try {
    const selected = promptTerminalSelect(
      "Select item",
      [
        { label: "First", value: "first" },
        { label: "Second", value: "second" },
      ],
      0,
      { streams: { input, output, close: () => undefined } },
    );
    assert.equal(await selected, "first");
    assert.equal(input.rawMode, false);
    assert.equal(input.paused, true);
  } finally {
    input.destroy();
  }
});

test("terminal selector handles first arrow key typed during initial render", async () => {
  const input = new FakeTtyInput();
  const output = new CaptureOutput(() => input.write("\u001b[B"));
  try {
    const selected = promptTerminalSelect(
      "Select item",
      [
        { label: "First", value: "first" },
        { label: "Second", value: "second" },
      ],
      0,
      { streams: { input, output, close: () => undefined } },
    );
    input.write("\r");
    assert.equal(await selected, "second");
    assert.equal(input.rawMode, false);
    assert.equal(input.paused, true);
  } finally {
    input.destroy();
  }
});

test("terminal selector handles split first arrow key bytes", async () => {
  const input = new FakeTtyInput();
  const output = new CaptureOutput();
  try {
    const selected = promptTerminalSelect(
      "Select item",
      [
        { label: "First", value: "first" },
        { label: "Second", value: "second" },
      ],
      0,
      { streams: { input, output, close: () => undefined } },
    );
    input.write("\u001b");
    input.write("[");
    input.write("B");
    input.write("\r");
    assert.equal(await selected, "second");
    assert.equal(input.rawMode, false);
    assert.equal(input.paused, true);
  } finally {
    input.destroy();
  }
});

test("terminal selector rerenders from wrapped choice row count", async () => {
  const input = new FakeTtyInput();
  const output = new CaptureOutput(undefined, 12);
  try {
    const selected = promptTerminalSelect(
      "Select item",
      [
        { label: "First choice with a long label", value: "first-choice" },
        { label: "Second", value: "second" },
      ],
      0,
      { streams: { input, output, close: () => undefined } },
    );
    input.write("\u001b[B");
    input.write("\r");
    assert.equal(await selected, "second");
    assert.match(output.text, /\u001b\[6A/);
    assert.equal(input.rawMode, false);
    assert.equal(input.paused, true);
  } finally {
    input.destroy();
  }
});

test("terminal selector handles input emitted while resuming raw input", async () => {
  const input = new FakeTtyInput("\r");
  const output = new CaptureOutput();
  try {
    const selected = promptTerminalSelect(
      "Select item",
      [
        { label: "First", value: "first" },
        { label: "Second", value: "second" },
      ],
      0,
      { streams: { input, output, close: () => undefined } },
    );
    assert.equal(await withTimeout(selected), "first");
    assert.equal(input.rawMode, false);
    assert.equal(input.paused, true);
  } finally {
    input.destroy();
  }
});

test("terminal selector enters raw mode before subscribing to data", async () => {
  const input = new FakeTtyInput();
  const output = new CaptureOutput();
  try {
    input.assertRawBeforeDataListener = true;
    const selected = promptTerminalSelect(
      "Select item",
      [
        { label: "First", value: "first" },
        { label: "Second", value: "second" },
      ],
      0,
      { streams: { input, output, close: () => undefined } },
    );
    input.write("\r");
    assert.equal(await selected, "first");
    assert.equal(input.rawBeforeDataListenerChecked, true);
    assert.equal(input.rawMode, false);
    assert.equal(input.paused, true);
  } finally {
    input.destroy();
  }
});

class FakeTtyInput extends PassThrough {
  isTTY = true;
  isRaw = false;
  paused = true;
  rawMode = false;
  assertRawBeforeDataListener = false;
  rawBeforeDataListenerChecked = false;
  private readonly resumeData?: string;

  constructor(resumeData?: string) {
    super();
    this.resumeData = resumeData;
  }

  setRawMode(value: boolean) {
    this.isRaw = value;
    this.rawMode = value;
    return this;
  }

  resume() {
    this.paused = false;
    if (this.resumeData) this.emit("data", Buffer.from(this.resumeData));
    return super.resume();
  }

  pause() {
    this.paused = true;
    return super.pause();
  }

  isPaused() {
    return this.paused;
  }

  on(eventName: string | symbol, listener: (...args: any[]) => void) {
    if (eventName === "data" && this.assertRawBeforeDataListener) {
      this.rawBeforeDataListenerChecked = true;
      assert.equal(this.rawMode, true);
    }
    return super.on(eventName, listener);
  }
}

async function withTimeout<T>(promise: Promise<T>): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("selection timed out")), 100);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

class CaptureOutput extends Writable {
  isTTY = true;
  readonly columns?: number;
  text = "";
  private wrote = false;
  private readonly onFirstWrite?: () => void;

  constructor(onFirstWrite?: () => void, columns?: number) {
    super();
    this.onFirstWrite = onFirstWrite;
    this.columns = columns;
  }

  _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void) {
    this.text += chunk.toString("utf8");
    if (!this.wrote) {
      this.wrote = true;
      this.onFirstWrite?.();
    }
    callback();
  }
}

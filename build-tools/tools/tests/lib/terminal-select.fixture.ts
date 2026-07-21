import assert from "node:assert/strict";
import { PassThrough, Writable } from "node:stream";

export class FakeTtyInput extends PassThrough {
  isTTY = true;
  isRaw = false;
  paused = true;
  rawMode = false;
  assertRawBeforeDataListener = false;
  rawBeforeDataListenerChecked = false;
  dropWritesWithoutDataListener = false;
  dataListenerViaOnCount = 0;
  onResume?: () => void;
  private readonly resumeData?: string;
  private subscribingDataListener = false;

  constructor(resumeData?: string) {
    super();
    this.resumeData = resumeData;
    super.on("newListener", (eventName) => {
      if (eventName === "data" && this.assertRawBeforeDataListener) {
        this.rawBeforeDataListenerChecked = true;
        assert.equal(this.rawMode, true);
      }
    });
  }

  setRawMode(value: boolean) {
    this.isRaw = value;
    this.rawMode = value;
    return this;
  }

  override write(
    chunk: any,
    encoding?: BufferEncoding | ((error?: Error | null) => void),
    callback?: (error?: Error | null) => void,
  ): boolean {
    if (this.dropWritesWithoutDataListener && this.listenerCount("data") === 0) {
      if (typeof encoding === "function") encoding();
      if (typeof callback === "function") callback();
      return true;
    }
    return super.write(chunk, encoding as BufferEncoding, callback);
  }

  resume() {
    this.paused = false;
    if (!this.subscribingDataListener) this.onResume?.();
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

  override emit(eventName: string | symbol, ...args: any[]) {
    if (eventName === "newListener" && args[0] === "data" && this.assertRawBeforeDataListener) {
      this.rawBeforeDataListenerChecked = true;
      assert.equal(this.rawMode, true);
    }
    return super.emit(eventName, ...args);
  }

  on(eventName: string | symbol, listener: (...args: any[]) => void) {
    if (eventName === "data") this.dataListenerViaOnCount += 1;
    if (eventName === "data" && this.assertRawBeforeDataListener) {
      this.rawBeforeDataListenerChecked = true;
      assert.equal(this.rawMode, true);
    }
    if (eventName !== "data") return super.on(eventName, listener);
    this.subscribingDataListener = true;
    try {
      return super.on(eventName, listener);
    } finally {
      this.subscribingDataListener = false;
    }
  }
}

export async function withTimeout<T>(promise: Promise<T>): Promise<T> {
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

export class CaptureOutput extends Writable {
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

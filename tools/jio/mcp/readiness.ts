export type ReadinessState =
  | "idle"
  | "initializing"
  | "discovering"
  | "validating"
  | "computingCaps"
  | "bindingTransport"
  | "ready"
  | "failed"
  | "closed";

export type ReadinessMachine = {
  start(): Promise<void>;
  getState(): ReadinessState;
  on(event: "ready" | "failed" | "closed", cb: () => void): void;
};

export function createReadinessMachine(opts: {
  onInitialize?: () => Promise<void>;
  onDiscover?: () => Promise<void>;
  onValidate?: () => Promise<void>;
  onComputeCaps: () => Promise<void>;
  onBindTransport: () => Promise<void>;
}): ReadinessMachine {
  let state: ReadinessState = "idle";
  const listeners = {
    ready: [] as Array<() => void>,
    failed: [] as Array<() => void>,
    closed: [] as Array<() => void>,
  };
  let emittedReady = false;
  const set = (s: ReadinessState) => (state = s);
  const emit = (k: keyof typeof listeners) => {
    for (const cb of listeners[k]) {
      try {
        cb();
      } catch {}
    }
  };
  return {
    async start() {
      try {
        set("initializing");
        if (opts.onInitialize) await opts.onInitialize();
        set("discovering");
        if (opts.onDiscover) await opts.onDiscover();
        set("validating");
        if (opts.onValidate) await opts.onValidate();
        set("computingCaps");
        await opts.onComputeCaps();
        set("bindingTransport");
        await opts.onBindTransport();
        set("ready");
        if (!emittedReady) {
          emittedReady = true;
          emit("ready");
        }
      } catch {
        set("failed");
        emit("failed");
      }
    },
    getState() {
      return state;
    },
    on(event, cb) {
      (listeners as any)[event].push(cb);
    },
  };
}

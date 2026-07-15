import process from "node:process";

export const MANAGED_CANCEL_READY = "viberoots-managed-cancel-ready";
export const MANAGED_CANCEL_REQUEST = "viberoots-managed-cancel-request";

type CancelSignal = "SIGINT" | "SIGTERM";
type CancelListener = (signal: CancelSignal) => void;

let initialized = false;
let requested: CancelSignal | null = null;
const listeners = new Set<CancelListener>();
let messageListener: ((message: unknown) => void) | null = null;

function cancelSignal(value: unknown): CancelSignal | null {
  return value === "SIGINT" || value === "SIGTERM" ? value : null;
}

export function initializeManagedCancellationChannel(): void {
  if (initialized || typeof process.send !== "function") return;
  initialized = true;
  messageListener = (message: unknown) => {
    if (!message || typeof message !== "object") return;
    const record = message as { type?: unknown; signal?: unknown };
    if (record.type !== MANAGED_CANCEL_REQUEST || requested) return;
    const signal = cancelSignal(record.signal);
    if (!signal) return;
    requested = signal;
    for (const listener of listeners) listener(signal);
  };
  process.on("message", messageListener);
  process.send({ type: MANAGED_CANCEL_READY });
  process.channel?.unref();
}

export function closeManagedCancellationChannel(): void {
  if (messageListener) process.off("message", messageListener);
  messageListener = null;
  if (process.connected) process.disconnect();
}

export function onManagedCancellation(listener: CancelListener): () => void {
  listeners.add(listener);
  if (requested) queueMicrotask(() => listener(requested!));
  return () => listeners.delete(listener);
}

export type TransportKind = "stdio";

export type ServerFlags = {
  transport?: TransportKind;
  timeoutMs?: number;
  collectLimit?: number;
  collectBytes?: number;
  cleanEnv?: boolean;
  passEnv?: string[];
  env?: Record<string, string>;
};

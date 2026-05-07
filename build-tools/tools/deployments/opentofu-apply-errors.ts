#!/usr/bin/env zx-wrapper

export class OpenTofuApplyMismatchError extends Error {
  readonly reason: string;

  constructor(reason: string, message: string) {
    super(message);
    this.reason = reason;
    this.name = "OpenTofuApplyMismatchError";
  }
}

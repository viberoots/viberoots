#!/usr/bin/env zx-wrapper

export class VercelApiOutcomeError extends Error {
  providerReleaseId?: string;
  publicUrl?: string;
  outcome: "failed" | "pending" | "ambiguous";

  constructor(
    message: string,
    opts: {
      outcome: VercelApiOutcomeError["outcome"];
      providerReleaseId?: string;
      publicUrl?: string;
    },
  ) {
    super(message);
    this.name = "VercelApiOutcomeError";
    this.outcome = opts.outcome;
    this.providerReleaseId = opts.providerReleaseId;
    this.publicUrl = opts.publicUrl;
  }
}

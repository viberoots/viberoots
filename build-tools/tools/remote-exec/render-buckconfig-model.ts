export type RemoteBuckAuth =
  | {
      mode: "mtls";
      caCerts: string;
      clientCert: string;
      clientKey: string;
    }
  | {
      mode: "headers";
      httpHeaders: string[];
    };

export type RemoteBuckFallbackPolicy = "strict-remote" | "hybrid" | "local-only";

export type RemoteBuckConfigInput = {
  artifactDir: string;
  engineAddress: string;
  casAddress: string;
  actionCacheAddress: string;
  instanceName: string;
  auth: RemoteBuckAuth;
  targetSystem: string;
  targetProfile: string;
  fallbackPolicy: RemoteBuckFallbackPolicy;
  eventLogReportDir: string;
};

export type RemoteBuckConfigResult = {
  configPath: string;
  configText: string;
  fingerprint: string;
  summary: string;
};

export const supportedBuckConfigKeys = {
  buck2_re_client: [
    "action_cache_address",
    "cas_address",
    "engine_address",
    "http_headers",
    "instance_name",
  ],
  "buck2_re_client.tls": ["tls_ca_certs", "tls_client_cert", "tls_client_key"],
  build: ["execution_platforms"],
} as const;

export const REQUIRED_AWS_EC2_ALARMS = [
  "service-down",
  "readiness-failure",
  "missing-worker-heartbeat",
  "queue-backlog",
  "repeated-worker-crash",
] as const;

#!/usr/bin/env zx-wrapper

const ENVIRONMENT_VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function isEnvironmentVariableName(value: string): boolean {
  return ENVIRONMENT_VARIABLE_NAME.test(value);
}

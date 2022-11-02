import { LogService } from "matrix-bot-sdk";

export const env = (key: string): string =>
  expect(process.env[key], `environment variable ${key}`);

export const expect = <V>(value: V | null | undefined, as = "value"): V => {
  if (value === null || value === undefined) throw new Error(`Missing ${as}`);

  return value;
};

export const logger = (name: string) => ({
  trace: <D>(m: string, d?: D) => LogService.trace(name, m, d),
  debug: <D>(m: string, d?: D) => LogService.debug(name, m, d),
  error: <D>(m: string, d?: D) => LogService.error(name, m, d),
  info: <D>(m: string, d?: D) => LogService.info(name, m, d),
  warn: <D>(m: string, d?: D) => LogService.warn(name, m, d),
});

export const maxDelay = 2147483647; // Approximately 25 days

export const optional = <V>(value: V | null | undefined): V[] =>
  value === null || value === undefined ? [] : [value];

export const sample = <T>(items: T[]): T | undefined =>
  items[Math.floor(Math.random() * items.length)];

export const unimplemented = (subject: unknown): never => {
  throw new Error(`Not implemented for ${JSON.stringify(subject)}`);
};

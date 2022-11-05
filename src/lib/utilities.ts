export const env = (key: string): string =>
  expect(process.env[key], `environment variable ${key}`);

export const expect = <V>(value: V | null | undefined, as = "value"): V => {
  if (value === null || value === undefined) throw new Error(`Missing ${as}`);

  return value;
};

export const maxDelay = 2147483647; // Approximately 25 days

export const optional = <V>(value: V | null | undefined): V[] =>
  value === null || value === undefined ? [] : [value];

export const sample = <T>(items: T[]): T | undefined =>
  items[Math.floor(Math.random() * items.length)];

export const unimplemented = (subject: unknown): never => {
  throw new Error(`Not implemented for ${JSON.stringify(subject)}`);
};

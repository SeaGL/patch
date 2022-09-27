export const { debug, error, info, warn } = console;

export const env = (key: string): string =>
  expect(process.env[key], `environment variable ${key}`);

export const expect = <V>(value: V | null | undefined, as = "value"): V => {
  if (value === null || value === undefined) throw new Error(`Missing ${as}`);

  return value;
};

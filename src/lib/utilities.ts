export const env = (key: string): string =>
  expect(process.env[key], `environment variable ${key}`);

export const expect = <T>(value: T | null | undefined, as = "value"): T => {
  if (value === null || value === undefined) throw new Error(`Missing ${as}`);

  return value;
};

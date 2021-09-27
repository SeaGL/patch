export const env = (key: string): string => {
  const value = process.env[key];

  if (typeof value !== "string") {
    throw new Error(`Missing environment variable: ${key}`);
  }

  return value;
};

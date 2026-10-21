// Reads the values the Config node adds to every item. Fails loudly when a value is missing.

export type ConfigItem = Readonly<Record<string, unknown>>;

export const configString = (item: ConfigItem, key: string): string => {
  const value = item[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Config is missing "${key}". Open the Config node and fill it in.`);
  }
  return value.trim();
};

export const configNumber = (item: ConfigItem, key: string): number => {
  const value = Number(item[key]);
  if (item[key] === '' || item[key] === null || item[key] === undefined || !Number.isFinite(value)) {
    throw new Error(`Config "${key}" must be a number.`);
  }
  return value;
};

export const configFlag = (item: ConfigItem, key: string): boolean => item[key] === true || item[key] === 'true';

export const readRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

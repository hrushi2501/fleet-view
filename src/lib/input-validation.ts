import { ActionError } from "./action-error";

export function finiteNumber(value: unknown, label: string, options: { min?: number; max?: number; fallback?: number } = {}): number {
  if (value === null || value === undefined || (typeof value === "string" && !value.trim())) {
    if (options.fallback !== undefined) return options.fallback;
    throw new ActionError(`${label} is required.`);
  }
  if (typeof value !== "number" && typeof value !== "string") throw new ActionError(`${label} must be a number.`);
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new ActionError(`${label} must be a finite number.`);
  if (options.min !== undefined && parsed < options.min) throw new ActionError(`${label} must be at least ${options.min}.`);
  if (options.max !== undefined && parsed > options.max) throw new ActionError(`${label} must be at most ${options.max}.`);
  return parsed;
}

/** Optional numeric fields retain their existing zero default, but malformed input is rejected. */
export function formNumber(fd: FormData, key: string): number {
  return finiteNumber(fd.get(key), key.replace(/([A-Z])/g, " $1"), { fallback: 0 });
}

export function positiveNumber(value: unknown, label: string): number {
  const number = finiteNumber(value, label, { min: 0 });
  if (number === 0) throw new ActionError(`${label} must be greater than zero.`);
  return number;
}

export function oneOf<T extends string>(value: string, allowed: readonly T[], label: string): T {
  if (!allowed.includes(value as T)) throw new ActionError(`Invalid ${label}.`);
  return value as T;
}

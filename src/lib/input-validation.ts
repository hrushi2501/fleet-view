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

export function positiveNumber(value: unknown, label: string, options: { max?: number } = {}): number {
  const number = finiteNumber(value, label, { min: 0, max: options.max });
  if (number <= 0) throw new ActionError(`${label} must be greater than zero.`);
  return number;
}

export function nonNegativeNumber(value: unknown, label: string, options: { max?: number; fallback?: number } = {}): number {
  return finiteNumber(value, label, { min: 0, max: options.max, fallback: options.fallback });
}

export function boundedNumber(
  value: unknown,
  label: string,
  options: { min: number; max: number; integer?: boolean; fallback?: number }
): number {
  const num = finiteNumber(value, label, { min: options.min, max: options.max, fallback: options.fallback });
  if (options.integer && !Number.isInteger(num)) {
    throw new ActionError(`${label} must be a whole integer.`);
  }
  return num;
}

export function percentageNumber(value: unknown, label: string, options: { fallback?: number } = {}): number {
  return boundedNumber(value, label, { min: 0, max: 100, fallback: options.fallback });
}

export function coordinatePair(
  latRaw: unknown,
  lngRaw: unknown,
  label: string = "Location"
): { lat: number | null; lng: number | null } {
  const latEmpty = latRaw === null || latRaw === undefined || (typeof latRaw === "string" && !latRaw.trim());
  const lngEmpty = lngRaw === null || lngRaw === undefined || (typeof lngRaw === "string" && !lngRaw.trim());

  if (latEmpty && lngEmpty) return { lat: null, lng: null };
  if (latEmpty || lngEmpty) throw new ActionError(`${label} coordinates require both latitude and longitude.`);

  const lat = finiteNumber(latRaw, "Latitude", { min: -90, max: 90 });
  const lng = finiteNumber(lngRaw, "Longitude", { min: -180, max: 180 });
  return { lat, lng };
}

export function validateDateRange(
  start: Date | string | null | undefined,
  end: Date | string | null | undefined,
  label: string = "Date range"
): void {
  if (!start || !end) return;
  const startDate = start instanceof Date ? start : new Date(start);
  const endDate = end instanceof Date ? end : new Date(end);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    throw new ActionError(`Invalid date provided for ${label}.`);
  }
  if (endDate.getTime() < startDate.getTime()) {
    throw new ActionError(`End date cannot be earlier than start date for ${label}.`);
  }
}

export function oneOf<T extends string>(value: string, allowed: readonly T[], label: string): T {
  if (!allowed.includes(value as T)) throw new ActionError(`Invalid ${label}.`);
  return value as T;
}

export function safeParseDate(
  value: unknown,
  label: string,
  options: { minYear?: number; maxYear?: number; required: true; fallback?: Date }
): Date;
export function safeParseDate(
  value: unknown,
  label: string,
  options?: { minYear?: number; maxYear?: number; required?: boolean; fallback?: Date }
): Date | null;
export function safeParseDate(
  value: unknown,
  label: string,
  options: { minYear?: number; maxYear?: number; required?: boolean; fallback?: Date } = {}
): Date | null {
  if (value === null || value === undefined || (typeof value === "string" && !value.trim())) {
    if (options.fallback !== undefined) return options.fallback;
    if (options.required) throw new ActionError(`${label} is required.`);
    return null;
  }
  const rawStr = typeof value === "string" ? value.trim() : null;
  if (rawStr && /^\d{4}-\d{2}-\d{2}$/.test(rawStr)) {
    const utcDate = new Date(`${rawStr}T00:00:00.000Z`);
    if (Number.isNaN(utcDate.getTime()) || utcDate.toISOString().slice(0, 10) !== rawStr) {
      throw new ActionError(`Invalid date provided for ${label}.`);
    }
  }

  const date = value instanceof Date ? value : new Date(String(value).trim());
  if (Number.isNaN(date.getTime())) {
    throw new ActionError(`Invalid date provided for ${label}.`);
  }
  const year = date.getFullYear();
  if (options.minYear !== undefined && year < options.minYear) {
    throw new ActionError(`${label} year cannot be earlier than ${options.minYear}.`);
  }
  if (options.maxYear !== undefined && year > options.maxYear) {
    throw new ActionError(`${label} year cannot be later than ${options.maxYear}.`);
  }
  return date;
}

/**
 * Sanitizes and normalizes string inputs:
 * 1. Safely handles empty File objects from multipart form uploads.
 * 2. Strips null bytes (\0) to prevent PostgreSQL "invalid byte sequence for encoding UTF8: 0x00" fatal errors.
 * 3. Strips harmful non-printable control characters (preserving space, \t, \n, \r).
 * 4. Trims leading and trailing whitespace.
 * 5. Enforces minLength and maxLength bounds to prevent memory denial-of-service or database column overflow.
 */
export function sanitizeString(
  value: unknown,
  label: string = "Input",
  options: { minLength?: number; maxLength?: number; required?: boolean; fallback?: string } = {}
): string {
  if (value === null || value === undefined) {
    if (options.fallback !== undefined) return options.fallback;
    if (options.required) throw new ActionError(`${label} is required.`);
    return "";
  }

  // Handle empty File / Blob objects from multipart form data
  if (typeof value === "object" && value !== null) {
    if ("size" in value && typeof (value as { size: unknown }).size === "number" && (value as { size: number }).size === 0) {
      if (options.fallback !== undefined) return options.fallback;
      if (options.required) throw new ActionError(`${label} is required.`);
      return "";
    }
  }

  const clean = String(value)
    .replace(/\0/g, "")
    .replace(/[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    .trim();

  if (!clean) {
    if (options.fallback !== undefined) return options.fallback;
    if (options.required) throw new ActionError(`${label} is required.`);
    return "";
  }

  if (options.minLength !== undefined && clean.length < options.minLength) {
    throw new ActionError(`${label} must be at least ${options.minLength} characters.`);
  }

  const max = options.maxLength ?? 5000;
  if (clean.length > max) {
    throw new ActionError(`${label} cannot exceed ${max} characters.`);
  }

  return clean;
}

/**
 * Sanitizes an optional string input, returning trimmed string or null if empty.
 */
export function sanitizeOptionalString(
  value: unknown,
  label: string = "Input",
  options: { maxLength?: number } = {}
): string | null {
  const result = sanitizeString(value, label, { maxLength: options.maxLength });
  return result.length > 0 ? result : null;
}

/**
 * Validates and sanitizes an alphanumeric identifier (CUID, UUID, or code).
 */
export function sanitizeId(value: unknown, label: string = "ID"): string {
  const id = sanitizeString(value, label, { required: true, maxLength: 100 });
  if (!/^[a-zA-Z0-9_\-:]+$/.test(id)) {
    throw new ActionError(`Invalid ${label} format.`);
  }
  return id;
}


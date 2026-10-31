import { Args } from './types';

// Small argument validators. Every one throws HandlerError, which the server turns into a
// {type:"error"} reply. Clients are untrusted, so nothing is assumed about the shape of args.

export const MAX_STRING_LENGTH = 256;
// Positions/scales beyond this are certainly mistakes (or attacks that would break clients).
const MAX_ABS_NUMBER = 1e6;

export class HandlerError extends Error {}

export function requireObject(args: unknown): Args {
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    throw new HandlerError('args must be an object');
  }
  return args as Args;
}

export function num(args: Args, key: string): number {
  const value = args[key];
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > MAX_ABS_NUMBER) {
    throw new HandlerError(`${key} must be a finite number`);
  }
  return value;
}

export function int(args: Args, key: string, min: number, max: number): number {
  const value = num(args, key);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new HandlerError(`${key} must be an integer between ${min} and ${max}`);
  }
  return value;
}

// A colour as 0xRRGGBB, or null for "none". Above num()'s limit, so it has its own check.
export function color(args: Args, key: string): number | null {
  const value = args[key];
  if (value === undefined || value === null) return null;
  if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 0xffffff) {
    throw new HandlerError(`${key} must be a colour between 0 and 0xffffff`);
  }
  return value as number;
}

export function str(args: Args, key: string): string {
  const value = args[key];
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_STRING_LENGTH) {
    throw new HandlerError(`${key} must be a string of 1-${MAX_STRING_LENGTH} characters`);
  }
  return value;
}

// Ids and model ids may arrive as numbers (older clients) or strings; we store strings.
export function idString(args: Args, key: string): string {
  const value = args[key];
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return str(args, key);
}

// Optional echo value (like tempId) that we return untouched, so it must be small and plain.
export function optionalEcho(args: Args, key: string): string | number | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.length <= MAX_STRING_LENGTH) return value;
  throw new HandlerError(`${key} must be a short string or a number`);
}

// Accepts true/false and 0/1 (the original client sent integers).
export function bool(args: Args, key: string): boolean {
  const value = args[key];
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  throw new HandlerError(`${key} must be a boolean`);
}

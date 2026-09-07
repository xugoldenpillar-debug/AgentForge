import { ERROR_CODES, ensure } from '../../shared/errors.ts';

const WINDOWS_ABSOLUTE_PATH = /^[A-Za-z]:[\\/]/;
const UNC_PATH = /^(?:\\\\|\/\/)/;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/u;
const FORMAT_CHARACTER = /\p{Cf}/u;
const WINDOWS_DEVICE_NAME = /^(?:con|prn|aux|nul|clock\$|com[1-9]|lpt[1-9])(?:\.|$)/iu;

export function validateRelativePath(value: string, field = 'relativePath'): string {
  ensure(typeof value === 'string', `${field} must be a relative path.`, 400, ERROR_CODES.REQUEST_VALIDATION_FAILED);
  ensure(value.length > 0 && value.length <= 512, `${field} is invalid.`, 400, ERROR_CODES.REQUEST_VALIDATION_FAILED);
  ensure(!value.startsWith('/') && !WINDOWS_ABSOLUTE_PATH.test(value) && !UNC_PATH.test(value), `${field} must be relative.`, 400, ERROR_CODES.REQUEST_VALIDATION_FAILED);
  ensure(!value.includes('\\'), `${field} must use normalized POSIX separators.`, 400, ERROR_CODES.REQUEST_VALIDATION_FAILED);
  ensure(!value.includes(':'), `${field} contains a platform-specific path separator.`, 400, ERROR_CODES.REQUEST_VALIDATION_FAILED);
  ensure(!value.includes('%'), `${field} must not contain encoded path data.`, 400, ERROR_CODES.REQUEST_VALIDATION_FAILED);
  ensure(!CONTROL_CHARACTER.test(value), `${field} contains a control character.`, 400, ERROR_CODES.REQUEST_VALIDATION_FAILED);
  ensure(!FORMAT_CHARACTER.test(value), `${field} contains a path-formatting control character.`, 400, ERROR_CODES.REQUEST_VALIDATION_FAILED);
  ensure(value.normalize('NFC') === value, `${field} must use NFC Unicode normalization.`, 400, ERROR_CODES.REQUEST_VALIDATION_FAILED);

  const segments = value.split('/');
  ensure(segments.every((segment) => {
    if (segment.length === 0 || segment === '.' || segment === '..') return false;
    // Windows trims trailing dots/spaces and reserves device names even when a
    // provider is currently running on POSIX. Rejecting them keeps the same
    // logical path from changing meaning across sandbox/storage providers.
    if (/[. ]$/u.test(segment) || WINDOWS_DEVICE_NAME.test(segment)) return false;
    return true;
  }), `${field} contains an unsafe segment.`, 400, ERROR_CODES.REQUEST_VALIDATION_FAILED);
  return value;
}

export function normalizedPathKey(value: string): string {
  const path = validateRelativePath(value);
  return path.normalize('NFC').toLocaleLowerCase('en-US').normalize('NFC');
}

export function compareRelativePaths(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function assertUniqueRelativePaths(paths: readonly string[], field = 'relativePath'): void {
  const seen = new Set<string>();
  for (const path of paths) {
    const key = normalizedPathKey(path);
    ensure(!seen.has(key), `${field} collides after path normalization.`, 400, ERROR_CODES.REQUEST_VALIDATION_FAILED);
    seen.add(key);
  }
}

export function validateBoundedLimit(value: number, maximum: number, field: string): number {
  ensure(Number.isSafeInteger(value) && value >= 0 && value <= maximum, `${field} is outside the permitted limit.`, 400, ERROR_CODES.REQUEST_VALIDATION_FAILED);
  return value;
}

export function validateOpaqueToken(value: string, field: string): string {
  ensure(typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value), `${field} is invalid.`, 400, ERROR_CODES.REQUEST_VALIDATION_FAILED);
  return value;
}

import { ApiError } from './errors';

/**
 * Response-shape validation at the network boundary.
 *
 * ROOT CAUSE THIS EXISTS FOR: `api.get<T>()` casts unvalidated JSON to `T`.
 * A wrong `T` therefore compiles clean, passes every unit test (which mock the
 * client), and fails silently at runtime — four endpoints shipped with the
 * wrong shape and rendered permanent empty states rather than errors, because
 * `data?.items ?? []` on an array response is `[]`, not a crash.
 *
 * A validator here converts that class of bug from "silently empty screen" into
 * "loud, attributable error", which is the only version a developer can fix.
 * Deliberately hand-rolled rather than zod: this needs to run on every response
 * on a phone, and the checks required are shallow.
 */
export type Validator<T> = (value: unknown, path: string) => T;

function fail(path: string, expected: string, got: unknown): never {
  const actual = Array.isArray(got) ? 'array' : got === null ? 'null' : typeof got;
  throw new ApiError({
    kind: 'unknown',
    status: 0,
    message: `Unexpected response shape from ${path}: expected ${expected}, got ${actual}`,
    path,
  });
}

/** Array of objects. Element contents are not inspected. */
export function expectArray<T>(value: unknown, path: string): T[] {
  if (!Array.isArray(value)) fail(path, 'an array', value);
  return value as T[];
}

/** Object that carries `key`. Guards against the array-vs-wrapper mixup. */
export function expectObjectWith<T>(key: string): Validator<T> {
  return (value, path) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      fail(path, `an object with "${key}"`, value);
    }
    if (!(key in (value as Record<string, unknown>))) {
      fail(path, `an object with "${key}"`, value);
    }
    return value as T;
  };
}

/** Object, contents unchecked. */
export function expectObject<T>(value: unknown, path: string): T {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(path, 'an object', value);
  }
  return value as T;
}

/** Object or null — for endpoints that legitimately return "nothing yet". */
export function expectNullableObject<T>(value: unknown, path: string): T | null {
  if (value === null || value === undefined) return null;
  return expectObject<T>(value, path);
}

export const CACHE_CLIENT = Symbol('CACHE_CLIENT');

export interface CacheClient {
  get(key: string): Promise<string | null>;
  setex(key: string, ttlSec: number, value: string): Promise<void>;
}

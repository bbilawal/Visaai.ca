import type { SupabaseClient } from '@supabase/supabase-js';
import type { DevicePlatform, DevicePushTokenRecord } from '@visaai/types';

export interface UpsertDeviceTokenInput {
  userId: string;
  token: string;
  platform: DevicePlatform;
  deviceName: string | null;
  appVersion: string | null;
}

export interface IDeviceTokenRepository {
  upsert(
    db: SupabaseClient,
    input: UpsertDeviceTokenInput,
  ): Promise<DevicePushTokenRecord>;
  listForUser(
    db: SupabaseClient,
    userId: string,
  ): Promise<DevicePushTokenRecord[]>;
  deleteByToken(db: SupabaseClient, token: string): Promise<void>;
}

export const DEVICE_TOKEN_REPOSITORY = Symbol('IDeviceTokenRepository');

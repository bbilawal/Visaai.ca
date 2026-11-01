import { Injectable } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { DevicePushTokenRecord } from '@visaai/types';
import {
  type IDeviceTokenRepository,
  type UpsertDeviceTokenInput,
} from './device-token.repository';

function unwrap<T>(res: { data: unknown; error: unknown }, ctx: string): T {
  if (res.error)
    throw new Error((res.error as { message?: string }).message ?? ctx);
  return res.data as T;
}

@Injectable()
export class DeviceTokenRepository implements IDeviceTokenRepository {
  async upsert(
    db: SupabaseClient,
    input: UpsertDeviceTokenInput,
  ): Promise<DevicePushTokenRecord> {
    const res = await db
      .from('device_push_tokens')
      .upsert(
        {
          user_id: input.userId,
          token: input.token,
          platform: input.platform,
          device_name: input.deviceName,
          app_version: input.appVersion,
          last_seen_at: new Date().toISOString(),
        },
        // Conflict on the token, not (user, token): when a device is handed to
        // another user the row must re-home to the new owner, otherwise the
        // previous owner keeps receiving that device's notifications.
        { onConflict: 'token' },
      )
      .select('*')
      .single();
    return unwrap<DevicePushTokenRecord>(res, 'upsert device push token');
  }

  async listForUser(
    db: SupabaseClient,
    userId: string,
  ): Promise<DevicePushTokenRecord[]> {
    const res = await db
      .from('device_push_tokens')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: true });
    if (res.error) throw new Error(res.error.message);
    return (res.data as DevicePushTokenRecord[]) ?? [];
  }

  async deleteByToken(db: SupabaseClient, token: string): Promise<void> {
    const res = await db.from('device_push_tokens').delete().eq('token', token);
    if (res.error) throw new Error(res.error.message);
  }
}

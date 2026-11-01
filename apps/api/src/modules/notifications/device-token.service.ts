import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import type { DevicePlatform, DevicePushTokenRecord } from '@visaai/types';
import { SupabaseService } from '../shared/supabase/supabase.service';
import {
  DEVICE_TOKEN_REPOSITORY,
  type IDeviceTokenRepository,
} from './device-token.repository';

export interface RegisterDeviceInput {
  token: string;
  platform: DevicePlatform;
  deviceName?: string | null;
  appVersion?: string | null;
}

export interface DeviceCaller {
  id: string;
}

const MAX_TOKEN_LENGTH = 512;
const MAX_LABEL_LENGTH = 120;

/**
 * Owner-scoped device push token management (mobile counterpart of
 * PushSubscriptionService). Writes go through `forUser` so the
 * device_push_tokens RLS (user_id = auth.uid()) is the isolation boundary —
 * a caller cannot register a token against someone else's account.
 */
@Injectable()
export class DeviceTokenService {
  constructor(
    @Inject(DEVICE_TOKEN_REPOSITORY)
    private readonly repo: IDeviceTokenRepository,
    private readonly supabase: SupabaseService,
  ) {}

  // `async` (not a bare Promise return) so a validation failure *rejects*
  // rather than throwing synchronously out of the call — otherwise a caller
  // doing `svc.register(...).catch(...)` never sees the BadRequestException.
  async register(
    accessToken: string,
    caller: DeviceCaller,
    input: RegisterDeviceInput,
  ): Promise<DevicePushTokenRecord> {
    const token = (input.token ?? '').trim();
    if (!token) throw new BadRequestException('token is required');
    if (token.length > MAX_TOKEN_LENGTH) {
      throw new BadRequestException('token is too long');
    }
    if (input.platform !== 'ios' && input.platform !== 'android') {
      throw new BadRequestException("platform must be 'ios' or 'android'");
    }
    return this.repo.upsert(this.supabase.forUser(accessToken), {
      userId: caller.id,
      token,
      platform: input.platform,
      // Device name is user-controlled ("Sam's iPhone") — clamp it so a hostile
      // client cannot stuff the column, and never log it (it identifies a person).
      deviceName: clamp(input.deviceName),
      appVersion: clamp(input.appVersion),
    });
  }

  /** RLS scopes the delete to the caller's own rows. */
  async unregister(
    accessToken: string,
    _caller: DeviceCaller,
    token: string,
  ): Promise<void> {
    if (!token) throw new BadRequestException('token is required');
    return this.repo.deleteByToken(this.supabase.forUser(accessToken), token);
  }

  list(
    accessToken: string,
    caller: DeviceCaller,
  ): Promise<DevicePushTokenRecord[]> {
    return this.repo.listForUser(this.supabase.forUser(accessToken), caller.id);
  }
}

function clamp(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, MAX_LABEL_LENGTH) : null;
}

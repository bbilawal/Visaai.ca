import { Inject, Injectable } from '@nestjs/common';
import type { NotificationPreferences } from '@visaai/types';
import { SupabaseService } from '../shared/supabase/supabase.service';
import {
  NOTIFICATION_PREFERENCE_REPOSITORY,
  type INotificationPreferenceRepository,
  type NotificationPreferencePatch,
} from './notification-preference.repository';
import type { NotifCaller } from './push-subscription.service';

@Injectable()
export class NotificationPreferenceService {
  constructor(
    @Inject(NOTIFICATION_PREFERENCE_REPOSITORY)
    private readonly repo: INotificationPreferenceRepository,
    private readonly supabase: SupabaseService,
  ) {}

  get(token: string, caller: NotifCaller): Promise<NotificationPreferences> {
    return this.repo.getForUser(this.supabase.forUser(token), caller.id);
  }

  update(
    token: string,
    caller: NotifCaller,
    patch: NotificationPreferencePatch,
  ): Promise<NotificationPreferences> {
    return this.repo.upsert(this.supabase.forUser(token), caller.id, patch);
  }

  /** Unsubscribe path (no auth token) — service-role disable. */
  disableEmailByUser(userId: string): Promise<void> {
    return this.repo.disableEmail(this.supabase.admin, userId);
  }
}

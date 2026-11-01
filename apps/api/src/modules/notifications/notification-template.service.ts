import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type {
  NotificationTemplate,
  NotificationTemplateInput,
} from '@visaai/types';
import { SupabaseService } from '../shared/supabase/supabase.service';
import {
  NOTIFICATION_TEMPLATE_REPOSITORY,
  type INotificationTemplateRepository,
} from './notification-template.repository';
import { renderTemplate } from './template-render';
import {
  renderEvent,
  type NotificationEvent,
  type RenderedNotification,
} from './events/catalog';

/**
 * NotificationTemplateService — resolves admin-managed template copy and manages
 * the template lifecycle (versioning + preview). `render()` is the ONLY hook into
 * dispatch: it overrides the catalog title/body when an active template exists,
 * and otherwise (or on ANY error) falls back to the code catalog — never throws
 * into emit().
 */
@Injectable()
export class NotificationTemplateService {
  private readonly log = new Logger(NotificationTemplateService.name);

  constructor(
    @Inject(NOTIFICATION_TEMPLATE_REPOSITORY)
    private readonly repo: INotificationTemplateRepository,
    private readonly supabase: SupabaseService,
  ) {}

  private varsOf(event: NotificationEvent): Record<string, string> {
    const out: Record<string, string> = {};
    const d = (event as { data?: Record<string, unknown> }).data ?? {};
    for (const [k, v] of Object.entries(d)) out[k] = v == null ? '' : String(v);
    if ('applicationId' in event)
      out.applicationId = (event as { applicationId: string }).applicationId;
    if ('paymentId' in event)
      out.paymentId = (event as { paymentId: string }).paymentId;
    return out;
  }

  /** Template-aware render for dispatch; falls back to the catalog on miss/error. */
  async render(
    event: NotificationEvent,
    locale: string,
  ): Promise<RenderedNotification> {
    const base = renderEvent(event);
    try {
      const admin = this.supabase.admin;
      const tpl =
        (await this.repo.getActive(admin, event.type, locale)) ??
        (locale !== 'en'
          ? await this.repo.getActive(admin, event.type, 'en')
          : null);
      if (!tpl) return base;
      const vars = this.varsOf(event);
      return {
        category: base.category,
        link: base.link,
        title: renderTemplate(tpl.title, vars),
        body: renderTemplate(tpl.body, vars),
      };
    } catch (err) {
      this.log.error(
        `template render(${event.type}) failed: ${(err as Error).message}`,
      );
      return base; // never break emit
    }
  }

  // ── admin CRUD (service-role; controller enforces admin-gating) ──

  list(filter?: {
    eventType?: string;
    locale?: string;
  }): Promise<NotificationTemplate[]> {
    return this.repo.list(this.supabase.admin, filter);
  }

  async get(id: string): Promise<NotificationTemplate> {
    const t = await this.repo.getById(this.supabase.admin, id);
    if (!t) throw new NotFoundException('template not found');
    return t;
  }

  /** Create a new active template version, deactivating any prior active one. */
  async create(
    input: NotificationTemplateInput,
    actorId: string,
  ): Promise<NotificationTemplate> {
    const admin = this.supabase.admin;
    const locale = input.locale ?? 'en';
    const nextVersion =
      (await this.repo.maxVersion(admin, input.event_type, locale)) + 1;
    await this.repo.deactivateActive(admin, input.event_type, locale);
    return this.repo.insert(admin, {
      event_type: input.event_type,
      locale,
      subject: input.subject ?? null,
      title: input.title,
      body: input.body,
      variables: input.variables ?? [],
      version: nextVersion,
      is_active: true,
      created_by: actorId,
    });
  }

  /** Edit = a new version of the template's (event_type, locale). */
  async update(
    id: string,
    input: NotificationTemplateInput,
    actorId: string,
  ): Promise<NotificationTemplate> {
    const current = await this.get(id);
    return this.create(
      {
        ...input,
        event_type: input.event_type ?? current.event_type,
        locale: input.locale ?? current.locale,
      },
      actorId,
    );
  }

  async deactivate(id: string): Promise<{ ok: true }> {
    await this.get(id); // 404 if missing
    await this.repo.deactivateById(this.supabase.admin, id);
    return { ok: true };
  }

  /** Render a draft template against sample variables (no persistence). */
  preview(
    input: { title: string; body: string },
    sampleVars: Record<string, string>,
  ): { title: string; body: string } {
    return {
      title: renderTemplate(input.title, sampleVars),
      body: renderTemplate(input.body, sampleVars),
    };
  }
}

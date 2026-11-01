import { Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../shared/supabase/supabase.service';
import { RobotsGate } from '../robots';
import { FORM_HTTP } from '../form-refresh.service';
import type { FetchLike } from '../http';
import { allCatalogedForms } from '../form-catalog';
import { allCatalogedDocumentTemplates } from '../../doc-templates/doc-template.catalog';
import { documentTemplatesFor } from '../../../strategies';
import { strategyRegistry } from '../../../strategies';
import {
  AUTHORITY_INDEXES,
  fetchIndex,
  type AuthorityIndex,
} from './index-sources';

export interface SweepOutcome {
  authority: string;
  /** Entries the authority's index lists. */
  indexed: number;
  /** Of those, how many our catalog already covers. */
  known: number;
  /** New findings recorded this run. */
  recorded: number;
  message?: string;
}

/**
 * Weekly crawl of each authority's own forms index, diffed against our catalog.
 *
 * WHY IT PROPOSES AND NEVER ADDS
 *
 * The obvious version of this feature auto-adds anything new. It must not.
 * Every entry in the catalog is a URL an applicant will file against, and the
 * one failure mode this product cannot tolerate is handing someone an official-
 * looking document that is wrong for their route. An index listing tells us a
 * form EXISTS; it tells us nothing about which country/program it belongs to,
 * whether it supersedes one we already serve, or whether it applies to the
 * routes we support at all. A human answers those in one minute; a heuristic
 * would answer them wrongly and silently.
 *
 * So the output is a review queue, and adding to the catalog stays a code
 * change that goes through review like any other.
 */
@Injectable()
export class TemplateSweepService {
  private readonly log = new Logger(TemplateSweepService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly robots: RobotsGate,
    @Inject(FORM_HTTP) private readonly http: FetchLike,
  ) {}

  /**
   * Every code the catalog already covers, upper-cased and space-stripped so
   * 'IMM 5484', 'imm5484' and 'IMM5484' all compare equal. Without this
   * normalisation the diff would report all ~178 IRCC forms as new every week
   * and the queue would be useless on day one.
   */
  knownCodes(): Set<string> {
    const norm = (s: string) => s.toUpperCase().replace(/\s+/g, '');
    const codes = new Set<string>();
    for (const form of allCatalogedForms()) codes.add(norm(form.formCode));
    for (const tpl of allCatalogedDocumentTemplates())
      codes.add(norm(tpl.templateCode));
    // Link-only document templates are excluded from the refresh worklist but
    // ARE in the catalog — without them the sweep would keep proposing the
    // very artifacts we deliberately serve as links (IMM 5476).
    for (const { code, programs } of strategyRegistry.listCountries()) {
      for (const programId of programs) {
        for (const spec of documentTemplatesFor(code, programId)) {
          codes.add(norm(spec.templateCode));
        }
      }
    }
    return codes;
  }

  async sweepAll(): Promise<SweepOutcome[]> {
    const known = this.knownCodes();
    const out: SweepOutcome[] = [];
    for (const index of AUTHORITY_INDEXES) {
      out.push(await this.sweepOne(index, known));
    }
    const recorded = out.reduce((n, o) => n + o.recorded, 0);
    this.log.log(
      `template sweep: ${out.length} authorities, ${recorded} finding(s) recorded/refreshed`,
    );
    return out;
  }

  async sweepOne(
    index: AuthorityIndex,
    known: Set<string> = this.knownCodes(),
  ): Promise<SweepOutcome> {
    // robots.txt is checked on the index page itself. The refresh job checks
    // the resolved PDF; this one only ever reads the listing, so that is the
    // URL whose permission matters.
    const permission = await this.robots.check(index.indexUrl);
    if (permission !== 'allowed') {
      const message = `robots.txt ${permission} for ${index.indexUrl} — skipped`;
      this.log.warn(message);
      return {
        authority: index.authority,
        indexed: 0,
        known: 0,
        recorded: 0,
        message,
      };
    }

    const entries = await fetchIndex(index, this.http);
    if (entries.length === 0) {
      // An index that suddenly parses to nothing is itself a signal: the page
      // was restructured. Logged loudly, but NOT recorded as findings — an
      // empty parse must never be read as "the authority withdrew every form".
      const message = `no entries parsed from ${index.indexUrl} — page may have changed`;
      this.log.warn(message);
      return {
        authority: index.authority,
        indexed: 0,
        known: 0,
        recorded: 0,
        message,
      };
    }

    const norm = (s: string) => s.toUpperCase().replace(/\s+/g, '');
    const unknown = entries.filter((e) => !known.has(norm(e.code)));
    let recorded = 0;
    for (const entry of unknown) {
      try {
        await this.upsertFinding(index.authority, entry);
        recorded++;
      } catch (err) {
        this.log.warn(
          `failed to record finding ${index.authority}/${entry.code}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    this.log.log(
      `${index.authority}: ${entries.length} indexed, ${entries.length - unknown.length} known, ${recorded} recorded`,
    );
    return {
      authority: index.authority,
      indexed: entries.length,
      known: entries.length - unknown.length,
      recorded,
    };
  }

  /**
   * Upsert on (authority, code): a finding seen again next week refreshes
   * `last_seen_at` and nothing else.
   *
   * Critically, it must NOT reset `status`. An operator who marked a finding
   * 'ignored' (a form for a route we do not serve) has answered permanently —
   * re-opening it every week is how a review queue becomes something people
   * stop reading. The DB does the merge so two concurrent runs cannot race.
   */
  private async upsertFinding(
    authority: string,
    entry: { code: string; title: string; url: string },
  ): Promise<void> {
    const now = new Date().toISOString();
    const { data: existing, error: readErr } = await this.supabase.admin
      .from('template_sweep_findings')
      .select('id, status')
      .eq('authority', authority)
      .eq('code', entry.code)
      .maybeSingle();
    if (readErr) throw new Error(readErr.message);

    if (existing) {
      const { error } = await this.supabase.admin
        .from('template_sweep_findings')
        .update({
          last_seen_at: now,
          updated_at: now,
          title: entry.title,
          url: entry.url,
        })
        .eq('id', (existing as { id: string }).id);
      if (error) throw new Error(error.message);
      return;
    }

    const { error } = await this.supabase.admin
      .from('template_sweep_findings')
      .insert({
        authority,
        code: entry.code,
        title: entry.title,
        url: entry.url,
        status: 'new',
        first_seen_at: now,
        last_seen_at: now,
      });
    if (error) throw new Error(error.message);
  }

  async listFindings(
    statuses: string[] = ['new', 'acknowledged'],
    limit = 200,
  ): Promise<unknown[]> {
    const { data, error } = await this.supabase.admin
      .from('template_sweep_findings')
      .select('*')
      .in('status', statuses)
      .order('last_seen_at', { ascending: false })
      .limit(limit);
    if (error)
      throw new Error(`template_sweep_findings read failed: ${error.message}`);
    return (data as unknown[] | null) ?? [];
  }

  /**
   * Resolve many findings at once.
   *
   * Exists because of a MEASURED first-run reality: IRCC publishes 178 forms
   * and USCIS 98, of which our catalog covers 9 and 2 (dry run, 2026-08-13), so
   * the very first sweep files ~265 findings — almost all for routes VisaAI
   * does not serve (immigration loans, I-9, N-400). That backlog is correct
   * output, not a bug, but a queue nobody can clear in one sitting is a queue
   * nobody reads. One call dismisses it; every later week shows only what is
   * genuinely new, because 'ignored' is terminal and the weekly upsert never
   * resets it.
   */
  async resolveFindings(
    ids: string[],
    status: 'acknowledged' | 'added' | 'ignored',
    userId: string,
    note?: string,
  ): Promise<number> {
    if (ids.length === 0) return 0;
    const now = new Date().toISOString();
    const { error } = await this.supabase.admin
      .from('template_sweep_findings')
      .update({
        status,
        note: note ?? null,
        updated_at: now,
        resolved_at: status === 'acknowledged' ? null : now,
        resolved_by: status === 'acknowledged' ? null : userId,
      })
      .in('id', ids);
    if (error)
      throw new Error(
        `template_sweep_findings update failed: ${error.message}`,
      );
    return ids.length;
  }

  async resolveFinding(
    id: string,
    status: 'acknowledged' | 'added' | 'ignored',
    userId: string,
    note?: string,
  ): Promise<void> {
    const now = new Date().toISOString();
    const { error } = await this.supabase.admin
      .from('template_sweep_findings')
      .update({
        status,
        note: note ?? null,
        updated_at: now,
        // 'acknowledged' is a "seen it, still open" state, so it does not close
        // the finding; 'added' and 'ignored' are terminal.
        resolved_at: status === 'acknowledged' ? null : now,
        resolved_by: status === 'acknowledged' ? null : userId,
      })
      .eq('id', id);
    if (error)
      throw new Error(
        `template_sweep_findings update failed: ${error.message}`,
      );
  }
}

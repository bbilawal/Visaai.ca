import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { FORM_REFRESH_QUEUE } from '../shared/queue/queue.constants';
import { FormRefreshService } from './form-refresh.service';
import { TemplateHealthService } from './template-health.service';

@Injectable()
@Processor(FORM_REFRESH_QUEUE)
export class FormRefreshProcessor extends WorkerHost {
  private readonly log = new Logger(FormRefreshProcessor.name);

  constructor(
    private readonly refresh: FormRefreshService,
    private readonly health: TemplateHealthService,
  ) {
    super();
  }

  async process(job?: { data?: { countryCode?: string } }): Promise<void> {
    // A country-scoped job refreshes only that country; a bare job (the manual
    // kick, or any older enqueued job) still does the whole catalog.
    const countryCode = job?.data?.countryCode;
    const results = countryCode
      ? await this.refresh.refreshCountry(countryCode)
      : await this.refresh.refreshAll();
    const counts = results.reduce<Record<string, number>>((acc, r) => {
      acc[r.status] = (acc[r.status] ?? 0) + 1;
      return acc;
    }, {});
    this.log.log(
      `form refresh complete${countryCode ? ` [${countryCode}]` : ''}: ${JSON.stringify(counts)}`,
    );

    // Watchdog runs right after the refresh, when the row states are freshest.
    // Wrapped because a health/alerting failure must never mark the refresh job
    // itself as failed — BullMQ would retry the whole crawl for an alerting bug.
    try {
      const report = await this.health.check();
      this.log.log(
        `template health: ${report.ok}/${report.total} ok, ` +
          `${report.degraded.length} degraded, ${report.unverified.length} unverified, ` +
          `${report.unreviewedRevisions} unreviewed revision(s)`,
      );
    } catch (err) {
      this.log.error(
        `template health check failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

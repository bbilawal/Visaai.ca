import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { DOC_TEMPLATE_REFRESH_QUEUE } from '../shared/queue/queue.constants';
import { DocRefreshService } from './doc-refresh.service';
import { TemplateHealthService } from '../forms/template-health.service';

@Injectable()
@Processor(DOC_TEMPLATE_REFRESH_QUEUE)
export class DocRefreshProcessor extends WorkerHost {
  private readonly log = new Logger(DocRefreshProcessor.name);

  constructor(
    private readonly refresh: DocRefreshService,
    private readonly health: TemplateHealthService,
  ) {
    super();
  }

  async process(job?: { data?: { countryCode?: string } }): Promise<void> {
    // Country-scoped when the scheduler said so; whole catalog otherwise (the
    // manual kick, or any job enqueued by an older build).
    const countryCode = job?.data?.countryCode;
    const results = countryCode
      ? await this.refresh.refreshCountry(countryCode)
      : await this.refresh.refreshAll();
    const counts = results.reduce<Record<string, number>>((acc, r) => {
      acc[r.status] = (acc[r.status] ?? 0) + 1;
      return acc;
    }, {});
    this.log.log(
      `document template refresh complete${countryCode ? ` [${countryCode}]` : ''}: ${JSON.stringify(counts)}`,
    );

    // Watchdog runs right after the refresh, when the row states are freshest.
    // Wrapped because an alerting failure must never fail the refresh job —
    // BullMQ would retry the whole crawl for a bug in the watchdog.
    try {
      const report = await this.health.check();
      this.log.log(
        `template health: ${report.ok}/${report.total} ok, ` +
          `${report.degraded.length} degraded, ${report.unverified.length} unverified, ` +
          `${report.openSweepFindings} open sweep finding(s)`,
      );
    } catch (err) {
      this.log.error(
        `template health check failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

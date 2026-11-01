import { Inject, Injectable } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Queue, type Job } from 'bullmq';
import { ANALYTICS_REPORTS_QUEUE } from '../../shared/queue/queue.constants';
import { SavedReportsService } from './saved-reports.service';
import { ReportDeliveryService } from './report-delivery.service';
import {
  ANALYTICS_REPORTS_REPOSITORY,
  type IAnalyticsReportsRepository,
} from './analytics-reports.repository';
import { nextRunAt } from './cron.util';

interface RunJob {
  savedReportId: string;
  scheduledReportId: string;
}

/**
 * Single WorkerHost on the reports queue. `tick` (from the scheduler) dispatches
 * a `run` job per due schedule and advances next_run_at; `run` executes one
 * report and delivers it.
 */
@Injectable()
@Processor(ANALYTICS_REPORTS_QUEUE)
export class ReportRunProcessor extends WorkerHost {
  constructor(
    @InjectQueue(ANALYTICS_REPORTS_QUEUE) private readonly queue: Queue,
    private readonly saved: SavedReportsService,
    private readonly delivery: ReportDeliveryService,
    @Inject(ANALYTICS_REPORTS_REPOSITORY)
    private readonly repo: IAnalyticsReportsRepository,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name === 'tick') return this.dispatch();
    if (job.name === 'run') return this.runOne(job.data as RunJob);
  }

  private async dispatch(): Promise<void> {
    const now = new Date();
    const due = await this.repo.listDueSchedules(now);
    for (const s of due) {
      await this.queue.add(
        'run',
        { savedReportId: s.savedReportId, scheduledReportId: s.id },
        { removeOnComplete: true, removeOnFail: 50 },
      );
      await this.repo.setNextRun(s.id, nextRunAt(s.cron, now));
    }
  }

  private async runOne(data: RunJob): Promise<void> {
    const { result, runId, saved } = await this.saved.run(
      data.savedReportId,
      new Date(),
      data.scheduledReportId,
    );
    const schedule = await this.repo.getScheduleForReport(data.savedReportId);
    if (schedule)
      await this.delivery.deliver({ saved, schedule, result, runId });
  }
}

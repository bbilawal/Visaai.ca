import { Inject, Injectable } from '@nestjs/common';
import {
  FINANCIAL_OPS_REPOSITORY,
  type IFinancialOpsRepository,
  type ReportDimension,
  type RevenueSummary,
} from './financial-ops.repository';

@Injectable()
export class FinancialReportService {
  constructor(
    @Inject(FINANCIAL_OPS_REPOSITORY)
    private readonly repo: IFinancialOpsRepository,
  ) {}

  summary(fromIso: string, toIso: string): Promise<RevenueSummary> {
    return this.repo.revenueSummary(fromIso, toIso);
  }

  async report(
    fromIso: string,
    toIso: string,
    by?: ReportDimension,
  ): Promise<{
    summary: RevenueSummary;
    breakdown?: { key: string; netCents: number }[];
  }> {
    const summary = await this.repo.revenueSummary(fromIso, toIso);
    if (!by) return { summary };
    const breakdown = await this.repo.revenueByDimension(fromIso, toIso, by);
    return { summary, breakdown };
  }
}

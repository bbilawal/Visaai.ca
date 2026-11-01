import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { FieldCryptoService } from '../shared/crypto/field-crypto.service';
import {
  PAYOUTS_REPOSITORY,
  type IPayoutsRepository,
  type TaxStatementRow,
} from './payouts.repository';

@Injectable()
export class PayoutTaxService {
  constructor(
    @Inject(PAYOUTS_REPOSITORY) private readonly repo: IPayoutsRepository,
    private readonly crypto: FieldCryptoService,
  ) {}

  private async consultantId(userId: string): Promise<string> {
    const profile = await this.repo.getProfileByUserId(userId);
    if (!profile) throw new NotFoundException('No consultant profile');
    return profile.id;
  }

  async upsertProfile(
    userId: string,
    input: {
      taxCountry: string;
      formType: 'w9' | 'w8';
      taxId?: string;
      businessName?: string;
    },
  ): Promise<void> {
    const consultantId = await this.consultantId(userId);
    const taxIdEncrypted = input.taxId
      ? this.crypto.encrypt(input.taxId)
      : null;
    await this.repo.upsertTaxProfile({
      consultantId,
      taxCountry: input.taxCountry,
      formType: input.formType,
      taxIdEncrypted,
      businessName: input.businessName ?? null,
      status: input.taxId ? 'submitted' : 'pending',
    });
  }

  async getProfile(userId: string): Promise<{
    taxCountry: string;
    formType: 'w9' | 'w8';
    businessName: string | null;
    status: string;
    taxIdMasked: string | null;
  } | null> {
    const consultantId = await this.consultantId(userId);
    const p = await this.repo.getTaxProfile(consultantId);
    if (!p) return null;
    let taxIdMasked: string | null = null;
    if (p.tax_id_encrypted) {
      const raw = this.crypto.decrypt(p.tax_id_encrypted);
      taxIdMasked = '***' + raw.slice(-4);
    }
    return {
      taxCountry: p.tax_country,
      formType: p.form_type,
      businessName: p.business_name,
      status: p.status,
      taxIdMasked,
    };
  }

  async generateStatement(
    userId: string,
    year: number,
  ): Promise<TaxStatementRow> {
    const consultantId = await this.consultantId(userId);
    const { grossPaidCents, payoutCount, currency } =
      await this.repo.sumPaidForYear(consultantId, year);
    return this.repo.upsertTaxStatement({
      consultantId,
      taxYear: year,
      currency,
      grossPaidCents,
      payoutCount,
    });
  }

  async generateAllForYear(year: number): Promise<{ generated: number }> {
    const ids = await this.repo.listConsultantsWithPaidPayouts(year);
    for (const consultantId of ids) {
      const { grossPaidCents, payoutCount, currency } =
        await this.repo.sumPaidForYear(consultantId, year);
      await this.repo.upsertTaxStatement({
        consultantId,
        taxYear: year,
        currency,
        grossPaidCents,
        payoutCount,
      });
    }
    return { generated: ids.length };
  }
}

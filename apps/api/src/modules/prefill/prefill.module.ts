import { Module, OnModuleInit } from '@nestjs/common';
import { PrefillController } from './prefill.controller';
import { PrefillService } from './prefill.service';
import { FormsModule } from '../forms/forms.module';
import { PreflightModule } from '../preflight/preflight.module';
import { FormTemplateStore } from '../forms/form-template.store';
import { setTemplateLoader } from './forms/imm5257';

/**
 * Prefill depends on the forms cache for official templates but not the other
 * way round. The loader is injected here rather than imported inside the
 * renderer so the renderer stays testable without Supabase.
 */
@Module({
  // PreflightModule: an applicant form save resets the covering review checks.
  imports: [FormsModule, PreflightModule],
  controllers: [PrefillController],
  providers: [PrefillService],
  exports: [PrefillService],
})
export class PrefillModule implements OnModuleInit {
  constructor(private readonly templates: FormTemplateStore) {}

  onModuleInit() {
    setTemplateLoader(async (formCode) => {
      // The renderer registry is keyed by form code alone (see
      // forms/index.ts), so the cache lookup is too — no hardcoded
      // country/program. A form required by multiple programs (IMM 5257:
      // visitor_visa and family_sponsorship both cache it) has one row per
      // program; findByFormCode() picks the best available copy rather than
      // reading one program's row unconditionally.
      const row = await this.templates.findByFormCode(formCode);
      if (!row?.storage_path) return null;
      if (row.capability !== 'acroform') return null; // XFA: not fillable
      return this.templates.getBytes(row.storage_path);
    });
  }
}

import type { PrefilledFormPayload } from '@visaai/types';
import { renderImm5257 } from './imm5257';
import { renderImm5476 } from './imm5476';
import { renderImm1294 } from './imm1294';
import {
  registerFormRenderer,
  resolveFormRenderer,
  isFormRendererRegistered,
  type FormRenderContext,
} from '../../../strategies/form-mapping/form-renderer.registry';

/**
 * Country form renderers register themselves into the global form-mapping
 * registry. The generic prefill pipeline resolves a renderer by form code (which
 * comes from the resolved program strategy), so it never hardcodes a form.
 *
 * Canada: IMM 5257. Add a country's form = register its renderer here; no changes
 * to the prefill service.
 */
registerFormRenderer('IMM 5257', renderImm5257);
registerFormRenderer('IMM 5476', renderImm5476);
registerFormRenderer('IMM 1294', renderImm1294);

export { preparedFormNote } from '../../../strategies/form-mapping/prepared-forms';

export function isOfficialFormSupported(formCode: string): boolean {
  return isFormRendererRegistered(formCode);
}

export async function tryRenderOfficialForm(
  formCode: string,
  payload: PrefilledFormPayload,
  ctx?: FormRenderContext,
): Promise<Uint8Array | null> {
  const fn = resolveFormRenderer(formCode);
  if (!fn) return null;
  try {
    return await fn(payload, ctx);
  } catch {
    return null;
  }
}

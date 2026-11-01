import type { PrefilledFormPayload } from '@visaai/types';
import { renderImm5257 } from './imm5257';
import {
  registerFormRenderer,
  resolveFormRenderer,
  isFormRendererRegistered,
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

export function isOfficialFormSupported(formCode: string): boolean {
  return isFormRendererRegistered(formCode);
}

export async function tryRenderOfficialForm(
  formCode: string,
  payload: PrefilledFormPayload,
): Promise<Uint8Array | null> {
  const fn = resolveFormRenderer(formCode);
  if (!fn) return null;
  try {
    return await fn(payload);
  } catch {
    return null;
  }
}

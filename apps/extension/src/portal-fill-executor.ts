import {
  PORTAL_FILL_PROTOCOL_VERSION,
  type PortalFillFieldResult,
  type PortalFillWriteCommand,
} from './shared'
import { verifyField } from './readback-engine'
import { resolveTarget } from './executor/resolve-target'

/**
 * Portal-fill executor — READ-ONLY SCAFFOLD (Phase 7E) + delegated verification
 * (Phase 7F).
 *
 * This is the future write+readback engine, but it currently implements the
 * READBACK + COMPARE half ONLY. It:
 *   - resolves the target selector (read)
 *   - reads the field's CURRENT value (read)
 *   - delegates normalize + hash + compare to the pure ReadbackEngine
 * It does NOT write/mutate any field, does NOT click/submit, does NOT navigate.
 *
 * The write step (native value injection + dispatch + settle) is intentionally
 * absent and added in a later phase. Until then `dryRunField` reports whether the
 * field already holds the expected value — a pure inspection.
 *
 * No DOM-write primitive appears in this file by design (enforced by
 * execution-path-invariant.spec).
 */
export async function dryRunField(cmd: PortalFillWriteCommand): Promise<PortalFillFieldResult> {
  const base = {
    protocol: PORTAL_FILL_PROTOCOL_VERSION,
    kind: 'field_result' as const,
    executionId: cmd.executionId,
    fieldKey: cmd.fieldKey,
  }

  const target = resolveTarget(cmd.selector)
  if (target.status !== 'found') {
    return { ...base, outcome: 'failed', reason: 'selector_missing', selectorFound: false }
  }
  const el = target.el as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement

  // READ ONLY — never assigns to the element. Verification is delegated to the
  // pure ReadbackEngine.
  const result = await verifyField(el.value ?? '', cmd.expectedValueHash)

  return {
    ...base,
    selectorFound: true,
    actualValueHash: result.actualValueHash,
    outcome: result.outcome,
    reason: result.reason,
  }
}

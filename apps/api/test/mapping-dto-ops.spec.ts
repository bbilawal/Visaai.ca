import { PORTAL_FILL_OPS } from '@visaai/types';
import { MappingDto as PreflightMapping } from '../src/modules/preflight/preflight.controller';
import { MappingDto as ExecutionMapping } from '../src/modules/execution-request/execution-request.controller';

/**
 * Prod 2026-10-17: 'attach_file' was added to PortalFillOp only. Every
 * preflight start/validate and execution request for an application with
 * document uploads failed validation, so no review could be locked.
 */
describe('request validators accept every portal fill op', () => {
  const base = {
    fieldKey: 'ircc_upload_passport',
    targetField: '#req_upload1_file_input',
    mappedValue: 'Passport: a.pdf [doc:x]',
    category: 'passport',
    page: '/doc-upload',
  };
  it.each(PORTAL_FILL_OPS.map((op) => [op]))('%s', (op) => {
    expect(PreflightMapping.safeParse({ ...base, op }).success).toBe(true);
    expect(ExecutionMapping.safeParse({ ...base, op }).success).toBe(true);
  });
});

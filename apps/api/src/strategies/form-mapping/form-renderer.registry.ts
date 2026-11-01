/**
 * Form Mapping Layer. Maps an official form code (from a program strategy's
 * forms()) to a renderer that stamps prefilled values onto the official PDF.
 *
 * Generic code resolves renderers by code through this registry; it never
 * references a specific form (IMM 5257, DS-160, ...). Each country's module
 * registers its renderers, so adding a country's form = a registration, not a
 * change to the prefill pipeline.
 */
export type FormRenderer = (payload: unknown) => Promise<Uint8Array | null>;

const renderers = new Map<string, FormRenderer>();

function normalize(code: string): string {
  // Strip all whitespace so 'IMM 5257', 'IMM5257', 'imm 5257' all match.
  return code.toUpperCase().replace(/\s+/g, '');
}

export function registerFormRenderer(formCode: string, fn: FormRenderer): void {
  renderers.set(normalize(formCode), fn);
}

export function resolveFormRenderer(
  formCode: string,
): FormRenderer | undefined {
  return renderers.get(normalize(formCode));
}

export function isFormRendererRegistered(formCode: string): boolean {
  return renderers.has(normalize(formCode));
}

export function registeredFormCodes(): string[] {
  return [...renderers.keys()];
}

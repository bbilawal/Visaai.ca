/**
 * Render a notification template by plain `{{variable}}` substitution.
 *
 * PURE + safe: only `[a-zA-Z0-9_]` placeholder names are matched and replaced
 * with the corresponding `vars` value — NO expression/code evaluation (no
 * template-injection surface). An unknown/absent variable renders as the empty
 * string (the placeholder is never left in the output, and `undefined`/`null`
 * never leak into the text). Whitespace inside the braces is tolerated.
 */
export function renderTemplate(
  tpl: string,
  vars: Record<string, string>,
): string {
  return String(tpl).replace(
    /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g,
    (_match, key: string) => {
      // Own-property only: an inherited name ({{constructor}}, {{toString}}, …)
      // must render empty, not leak the prototype member's value.
      if (!Object.prototype.hasOwnProperty.call(vars, key)) return '';
      const v = vars[key];
      return v === undefined || v === null ? '' : String(v);
    },
  );
}

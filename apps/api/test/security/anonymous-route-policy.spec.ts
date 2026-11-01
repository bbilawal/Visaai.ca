import 'reflect-metadata';
import { ALLOW_ANONYMOUS_KEY } from '../../src/modules/auth/jwt.guard';
import { IntakeController } from '../../src/modules/intake/intake.controller';
import { MeController } from '../../src/modules/me/me.controller';
import { DocumentsController } from '../../src/modules/documents/documents.controller';
import { NarrativeController } from '../../src/modules/narrative/narrative.controller';
import { PreflightController } from '../../src/modules/preflight/preflight.controller';
import { ProgressController } from '../../src/modules/progress/progress.controller';

function allowsAnonymous(ctrl: unknown): boolean {
  return Reflect.getMetadata(ALLOW_ANONYMOUS_KEY, ctrl as object) === true;
}

describe('Security — anonymous route policy (allow-list is tight)', () => {
  // The ONLY controllers a guest may reach. If this list grows, it must be a
  // deliberate, reviewed decision — a guest reaching anything else is a leak.
  it('intake + me opt into @AllowAnonymous', () => {
    expect(allowsAnonymous(IntakeController)).toBe(true);
    expect(allowsAnonymous(MeController)).toBe(true);
  });

  it('gated controllers do NOT allow anonymous (fail-closed default)', () => {
    expect(allowsAnonymous(DocumentsController)).toBe(false);
    expect(allowsAnonymous(NarrativeController)).toBe(false);
    expect(allowsAnonymous(PreflightController)).toBe(false);
    expect(allowsAnonymous(ProgressController)).toBe(false);
  });
});

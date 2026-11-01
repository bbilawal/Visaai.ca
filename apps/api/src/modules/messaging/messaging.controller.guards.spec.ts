import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { ApplicationAccessGuard } from '../auth/application-access.guard';
import { MessagingController } from './messaging.controller';
import { ConsultantNotesController } from './consultant-notes.controller';
import { DocumentRequestController } from './document-request.controller';
import { EscalationController } from './escalation.controller';
import { MessagingAttachmentsController } from './messaging-attachments.controller';
import { MessagingAiController } from './messaging-ai.controller';

/**
 * Messaging routes 500'd for a consultant NOT assigned to the application. The
 * service's own check reads `applications` under the caller's RLS scope, which
 * also shows queue-eligible UNASSIGNED applications to consultants covering
 * that country — so the check passed, the conversations RLS (owner / active
 * assignee / admin) hid the row, the INSERT was rejected (42501) and the
 * repository rethrew it as a bare Error. Every `:applicationId` route must
 * refuse non-participants with ApplicationAccessGuard (403).
 */
const CONTROLLERS = [
  MessagingController,
  ConsultantNotesController,
  DocumentRequestController,
  EscalationController,
  MessagingAttachmentsController,
  MessagingAiController,
];

const appRoutes = CONTROLLERS.flatMap((C) =>
  Object.getOwnPropertyNames(C.prototype)
    .map((name) => ({
      label: `${C.name}.${name}`,
      handler: (C.prototype as unknown as Record<string, unknown>)[name] as object,
    }))
    .filter(({ handler }) => {
      const path = Reflect.getMetadata(PATH_METADATA, handler) as
        | string
        | undefined;
      return typeof path === 'string' && path.startsWith(':applicationId');
    }),
);

describe('messaging :applicationId routes', () => {
  it('finds the application-keyed routes (guards the test)', () => {
    expect(appRoutes.length).toBeGreaterThanOrEqual(17);
  });

  it.each(appRoutes.map((r) => [r.label, r.handler]))(
    '%s is guarded by ApplicationAccessGuard',
    (_label, handler) => {
      const guards = Reflect.getMetadata(GUARDS_METADATA, handler as object) as
        | unknown[]
        | undefined;
      expect(guards).toContain(ApplicationAccessGuard);
    },
  );
});

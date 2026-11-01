import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { AUDIT_REPOSITORY } from './audit.repository';
import { AuditRepository } from './audit.repository.impl';

/**
 * AuditModule — @Global because many modules emit audit events through the
 * single AuditService writer.
 *
 * ENFORCEMENT: AUDIT_REPOSITORY (the concrete AuditRepository) is provided here
 * but deliberately NOT exported. Only AuditService — which lives in this module —
 * can inject it. No other module can reach the audit write path. Combined with
 * the DB-level guard (definer-only RPC + UPDATE/DELETE triggers), this makes
 * AuditService the sole system-of-record writer.
 */
@Global()
@Module({
  providers: [
    AuditService,
    { provide: AUDIT_REPOSITORY, useClass: AuditRepository },
  ],
  exports: [AuditService],
})
export class AuditModule {}

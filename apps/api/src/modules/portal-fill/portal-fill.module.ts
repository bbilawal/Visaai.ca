import { Module } from '@nestjs/common';
import { WritePlanBuilder } from './write-plan.builder';
import { WriteIntentSigner } from './write-intent.signer';
import { PortalFillOrchestrator } from './portal-fill-orchestrator';
import {
  EXTENSION_TRANSPORT,
  ExtensionBridgeExecutor,
  FIELD_EXECUTOR,
} from './field-executor.port';
import { SocketExtensionTransport } from './socket-extension.transport';
import { PortalDocumentFiles } from './portal-document-files';
import { PreflightModule } from '../preflight/preflight.module';
import { ProvenanceModule } from '../provenance/provenance.module';

/**
 * PortalFillModule — Phase 7D–7H server side.
 *  - WritePlanBuilder (7D) · WriteIntentSigner (7D)
 *  - PortalFillOrchestrator (7G): single-cursor execute→verify loop + audit
 *  - FIELD_EXECUTOR → ExtensionBridgeExecutor (7H): real executor over a transport
 *  - EXTENSION_TRANSPORT → SocketExtensionTransport (7J): the live extension
 *    channel. Still fail-closed — an execution with no bound socket returns a
 *    failed result rather than proceeding. DisconnectedTransport remains for
 *    tests and as the explicit "no channel" binding.
 *
 * The DOM write lives only in the extension; the server never accesses the DOM
 * and has no submit path. AuditService via @Global.
 */
@Module({
  imports: [PreflightModule, ProvenanceModule],
  providers: [
    WritePlanBuilder,
    WriteIntentSigner,
    PortalFillOrchestrator,
    PortalDocumentFiles,
    SocketExtensionTransport,
    { provide: FIELD_EXECUTOR, useClass: ExtensionBridgeExecutor },
    { provide: EXTENSION_TRANSPORT, useExisting: SocketExtensionTransport },
  ],
  exports: [
    WritePlanBuilder,
    WriteIntentSigner,
    PortalFillOrchestrator,
    SocketExtensionTransport,
  ],
})
export class PortalFillModule {}

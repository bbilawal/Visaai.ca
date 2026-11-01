import { Module } from '@nestjs/common';
import { AutomationController } from './automation.controller';
import { AutomationService } from './automation.service';
import { AutomationGateway } from './automation.gateway';
import { SessionTokenService } from './session-token.service';
import { EligibilityModule } from '../eligibility/eligibility.module';
import { PortalFillModule } from '../portal-fill/portal-fill.module';
import { ExecutionModule } from '../execution/execution.module';

/**
 * Phase 3E: EligibilityModule imported so AutomationService can expose a
 * READ-ONLY eligibility gate.
 *
 * Phase 7J: PortalFillModule + ExecutionModule imported so AutomationGateway can
 * serve the verified execution path (portal-fill:start) — readback-token auth,
 * live lock revalidation, signed intents, orchestrated single-cursor write.
 */
@Module({
  imports: [EligibilityModule, PortalFillModule, ExecutionModule],
  controllers: [AutomationController],
  providers: [AutomationService, AutomationGateway, SessionTokenService],
})
export class AutomationModule {}

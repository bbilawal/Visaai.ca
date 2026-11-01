import { Module } from '@nestjs/common';
import { VriController } from './vri.controller';
import { VriService } from './vri.service';
import { RiskConfigController } from './risk-config.controller';
import { RiskConfigService } from './risk-config.service';
import { RISK_CONFIG_REPOSITORY } from './risk-config.repository';
import { RiskConfigRepository } from './risk-config.repository.impl';
import { ConsultantModule } from '../consultant/consultant.module';

@Module({
  // ConsultantModule exports AssignmentService for auto-escalate-on-low-score.
  imports: [ConsultantModule],
  controllers: [VriController, RiskConfigController],
  providers: [
    VriService,
    RiskConfigService,
    { provide: RISK_CONFIG_REPOSITORY, useClass: RiskConfigRepository },
  ],
  exports: [VriService, RiskConfigService],
})
export class VriModule {}

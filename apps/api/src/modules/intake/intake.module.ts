import { Module } from '@nestjs/common';
import { IntakeController } from './intake.controller';
import { IntakeService } from './intake.service';
import { IntakeGateway } from './intake.gateway';

@Module({
  controllers: [IntakeController],
  providers: [IntakeService, IntakeGateway],
})
export class IntakeModule {}

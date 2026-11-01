import { Module } from '@nestjs/common';
import { ConsultantModule } from '../consultant/consultant.module';
import { RealtimeController } from './realtime.controller';

/**
 * SSE delivery layer for the consultant queue. Imports ConsultantModule for
 * AssignmentService (country scope lookup). AssignmentEventBus comes from the
 * @Global EventBusModule. No business logic here — pure transport.
 */
@Module({
  imports: [ConsultantModule],
  controllers: [RealtimeController],
})
export class RealtimeModule {}

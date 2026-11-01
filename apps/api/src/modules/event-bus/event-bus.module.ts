import { Global, Module } from '@nestjs/common';
import { AssignmentEventBus } from './assignment-event-bus';

/**
 * Global so any module (consultant, intake, …) can inject AssignmentEventBus to
 * EMIT lifecycle events without importing the realtime/SSE layer — keeps the
 * services decoupled from streaming and avoids circular module deps.
 */
@Global()
@Module({
  providers: [AssignmentEventBus],
  exports: [AssignmentEventBus],
})
export class EventBusModule {}

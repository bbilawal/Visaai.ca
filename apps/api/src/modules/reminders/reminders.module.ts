import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { REMINDER_QUEUE } from '../shared/queue/queue.constants';
import { RemindersService } from './reminders.service';
import { RemindersProcessor } from './reminders.processor';
import { RemindersScheduler } from './reminders.scheduler';
import { RemindersController } from './reminders.controller';
import { ProgressModule } from '../progress/progress.module';

@Module({
  imports: [BullModule.registerQueue({ name: REMINDER_QUEUE }), ProgressModule],
  controllers: [RemindersController],
  providers: [RemindersService, RemindersProcessor, RemindersScheduler],
})
export class RemindersModule {}

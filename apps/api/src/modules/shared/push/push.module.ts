import { Global, Module } from '@nestjs/common';
import { WebPushService } from './web-push.service';
import { ExpoPushService } from './expo-push.service';

@Global()
@Module({
  providers: [WebPushService, ExpoPushService],
  exports: [WebPushService, ExpoPushService],
})
export class PushModule {}

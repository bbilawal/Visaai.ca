import { MessagingModule } from '../src/modules/messaging/messaging.module';
import { MessagingSseController } from '../src/modules/messaging/messaging-sse.controller';
import { MessagingController } from '../src/modules/messaging/messaging.controller';

/**
 * Route-ordering invariant. Both controllers are mounted at `@Controller('messaging')`.
 * MessagingSseController declares `GET /messaging/stream`; MessagingController declares
 * `GET /messaging/:applicationId`. Nest registers controllers in array order, so the SSE
 * controller MUST come first — otherwise `/messaging/stream` is captured by the param
 * route and the SSE open 500s ("invalid input syntax for type uuid: stream"). Unit tests
 * subscribe to the observable directly and never exercise HTTP routing, so this guards the
 * ordering that only an end-to-end request would otherwise reveal.
 */
describe('Messaging controller registration order', () => {
  it('registers MessagingSseController before MessagingController', () => {
    const controllers = Reflect.getMetadata(
      'controllers',
      MessagingModule,
    ) as unknown[];
    const sse = controllers.indexOf(MessagingSseController);
    const main = controllers.indexOf(MessagingController);
    expect(sse).toBeGreaterThanOrEqual(0);
    expect(main).toBeGreaterThanOrEqual(0);
    expect(sse).toBeLessThan(main);
  });
});

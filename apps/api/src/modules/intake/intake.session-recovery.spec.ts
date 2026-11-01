import { ConflictException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IntakeService } from './intake.service';
import { SupabaseService } from '../shared/supabase/supabase.service';
import { CheckpointService } from '../shared/langgraph/checkpoint.service';
import { AssignmentEventBus } from '../event-bus/assignment-event-bus';
import { AiUsageMeter } from '../shared/ai/ai-usage.meter';

/** `applications` resolves to an owned row; nothing else is reached. */
function makeDb() {
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    order: () => Promise.resolve({ data: [], error: null }),
    single: () => Promise.resolve({ data: { id: 'app-1' }, error: null }),
  };
  return { from: () => chain } as any;
}

function makeService(checkpoint: Partial<CheckpointService>) {
  const locks = {
    acquireMessageLock: jest.fn().mockResolvedValue(true),
    releaseMessageLock: jest.fn().mockResolvedValue(undefined),
  };
  return new IntakeService(
    {} as SupabaseService,
    { ...locks, ...checkpoint } as CheckpointService,
    { get: jest.fn() } as unknown as ConfigService,
    { emit: jest.fn() } as unknown as AssignmentEventBus,
    {} as AiUsageMeter,
  );
}

describe('IntakeService.sendMessage — a missing session is recoverable', () => {
  it('opens the session instead of rejecting the turn', async () => {
    // The production failure this closes: `setVisaType` deletes the checkpoint
    // by design, and nothing re-created it. Every message after a visa-type
    // change threw "No active session — call startOrResume first", the client
    // never re-emitted `intake:start`, and the interview was dead until the
    // applicant guessed to reload the page. 2026-09-03: three consecutive
    // failures behind one "Something went wrong" banner.
    const svc = makeService({ load: jest.fn().mockResolvedValue(null) });
    const opened = new Error('startOrResume reached');
    const start = jest.spyOn(svc, 'startOrResume').mockRejectedValue(opened);

    await expect(
      svc.sendMessage(makeDb(), 'app-1', 'user-1', 'hello'),
    ).rejects.toBe(opened);
    // ...and without slotting its opening question into the transcript above
    // the answer the applicant already sent.
    expect(start).toHaveBeenCalledWith(expect.anything(), 'app-1', 'user-1', {
      persistOpening: false,
    });
  });

  it('still refuses a turn on an application the caller does not own', async () => {
    // Authorization stays ahead of the recovery: recovering a session must not
    // become a way to open one on someone else's application.
    const svc = makeService({ load: jest.fn().mockResolvedValue(null) });
    const start = jest.spyOn(svc, 'startOrResume');
    const denied: any = {
      from: () => {
        const chain: any = {
          select: () => chain,
          eq: () => chain,
          single: () =>
            Promise.resolve({
              data: null,
              error: { code: 'PGRST116', message: 'no rows', details: '' },
            }),
        };
        return chain;
      },
    };

    await expect(
      svc.sendMessage(denied, 'app-1', 'intruder', 'hello'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(start).not.toHaveBeenCalled();
  });

  it('does not load or overwrite a checkpoint while another message owns its lease', async () => {
    const load = jest.fn();
    const svc = makeService({
      load,
      acquireMessageLock: jest.fn().mockResolvedValue(false),
    });

    await expect(
      svc.sendMessage(makeDb(), 'app-1', 'user-1', 'second message'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(load).not.toHaveBeenCalled();
  });
});

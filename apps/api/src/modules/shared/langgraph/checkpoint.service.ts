import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from '@upstash/redis';
import {
  HumanMessage,
  AIMessage,
  SystemMessage,
  BaseMessage,
} from '@langchain/core/messages';
import type { Env } from '../../../config/configuration';

interface SerializedMessage {
  type: 'human' | 'ai' | 'system';
  content: string;
}

interface SerializableState {
  messages?: BaseMessage[] | SerializedMessage[];
  [key: string]: unknown;
}

@Injectable()
export class CheckpointService implements OnModuleInit {
  private redis: Redis;

  constructor(private config: ConfigService<Env>) {}

  onModuleInit() {
    this.redis = new Redis({
      url: this.config.get('UPSTASH_REDIS_REST_URL', { infer: true })!,
      token: this.config.get('UPSTASH_REDIS_REST_TOKEN', { infer: true })!,
    });
  }

  async save(threadId: string, state: unknown): Promise<void> {
    const s = state as SerializableState;
    const serialized = {
      ...s,
      messages: (s.messages ?? []).map((m): SerializedMessage => {
        const msg = m as BaseMessage;
        return {
          type: msg.getType() as 'human' | 'ai' | 'system',
          content:
            typeof msg.content === 'string'
              ? msg.content
              : JSON.stringify(msg.content),
        };
      }),
    };
    await this.redis.set(
      `intake:checkpoint:${threadId}`,
      JSON.stringify(serialized),
      { ex: 86400 * 7 },
    );
  }

  async load(threadId: string): Promise<unknown | null> {
    const raw = await this.redis.get<string>(`intake:checkpoint:${threadId}`);
    if (!raw) return null;
    const parsed = (
      typeof raw === 'string' ? JSON.parse(raw) : raw
    ) as SerializableState;

    const messages: BaseMessage[] = (
      (parsed.messages ?? []) as SerializedMessage[]
    ).map((m) => {
      if (m.type === 'human') return new HumanMessage(m.content);
      if (m.type === 'system') return new SystemMessage(m.content);
      return new AIMessage(m.content);
    });

    return { ...parsed, messages };
  }

  /**
   * Claim the right to generate a thread's opening turn. SET NX: the first
   * caller gets `true`, everyone else gets `false` until the lock expires.
   *
   * startOrResume decides whether to generate by loading the checkpoint, then
   * spends a long LLM call generating, then saves. Between the load and the
   * save the answer to "has this already been started?" is still "no", so a
   * second start in that window — which socket.io produces on EVERY reconnect,
   * since `intake:start` is emitted from the `connect` handler — runs the graph
   * again and appends a second opening message to the transcript.
   *
   * The TTL is a deadlock guard: if the holder dies mid-generation the lock
   * lapses and the next start may legitimately retry.
   */
  async acquireStartLock(
    threadId: string,
    ttlSeconds: number,
  ): Promise<boolean> {
    const res = await this.redis.set(`intake:start-lock:${threadId}`, '1', {
      nx: true,
      ex: ttlSeconds,
    });
    return res === 'OK';
  }

  async releaseStartLock(threadId: string): Promise<void> {
    await this.redis.del(`intake:start-lock:${threadId}`);
  }

  /**
   * Per-turn lease. Unlike the start lock this has an owner token: a stalled
   * worker whose TTL elapsed must never delete a replacement worker's lock.
   */
  async acquireMessageLock(
    threadId: string,
    token: string,
    ttlSeconds: number,
  ): Promise<boolean> {
    const res = await this.redis.set(`intake:message-lock:${threadId}`, token, {
      nx: true,
      ex: ttlSeconds,
    });
    return res === 'OK';
  }

  async releaseMessageLock(threadId: string, token: string): Promise<void> {
    await this.redis.eval(
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
      [`intake:message-lock:${threadId}`],
      [token],
    );
  }

  async delete(threadId: string): Promise<void> {
    await this.redis.del(`intake:checkpoint:${threadId}`);
  }
}

import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import type { Env } from '../../config/configuration';

/** DI token for the shared OpenAI client used by the visa agents. */
export const VISA_OPENAI = Symbol('VISA_OPENAI');

export const visaOpenAiProvider = {
  provide: VISA_OPENAI,
  inject: [ConfigService],
  useFactory: (config: ConfigService<Env>): OpenAI => {
    const apiKey = config.get('OPENAI_API_KEY', { infer: true });
    return new OpenAI({ apiKey });
  },
};

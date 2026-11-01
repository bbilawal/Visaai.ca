import type { CountryCode, VisaProgramId } from './types';
import type { CountryStrategy } from './country/base-country.strategy';
import type { VisaProgramStrategy } from './visa-program/base-visa-program.strategy';

export interface ResolvedStrategy {
  country: CountryStrategy;
  program: VisaProgramStrategy;
}

/**
 * Central registry. The ONLY thing the core pipeline calls to obtain
 * country/program behavior. Adding a country or program = register a strategy
 * here (or via index.ts); no changes to intake/documents/vri/narrative code.
 */
export class StrategyRegistry {
  private countries = new Map<string, CountryStrategy>();

  registerCountry(strategy: CountryStrategy): void {
    this.countries.set(strategy.code.toUpperCase(), strategy);
  }

  getCountry(code: CountryCode): CountryStrategy | undefined {
    return this.countries.get(String(code).toUpperCase());
  }

  resolve(
    code: CountryCode,
    programId: VisaProgramId,
  ): ResolvedStrategy | undefined {
    const country = this.getCountry(code);
    if (!country) return undefined;
    const program = country.getProgram(programId);
    if (!program) return undefined;
    return { country, program };
  }

  /**
   * The program behind a registry route (`visa_types.visaai_id`), or
   * undefined when no program claims it — callers then keep their defaults.
   */
  resolveRoute(
    code: CountryCode | null | undefined,
    visaaiId: string | null | undefined,
  ): ResolvedStrategy | undefined {
    if (!code || !visaaiId) return undefined;
    const country = this.getCountry(code);
    if (!country) return undefined;
    const id = visaaiId.trim();
    const program = country
      .programs()
      .find((p) => p.registryVisaaiIds?.includes(id));
    return program ? { country, program } : undefined;
  }

  listCountries(): { code: string; name: string; programs: string[] }[] {
    return [...this.countries.values()]
      .filter((c) => c.selectable !== false) // hide non-selectable (SCHENGEN bloc)
      .map((c) => ({
        code: c.code,
        name: c.name,
        programs: c.programs().map((p) => p.id),
      }));
  }
}

/** Process-wide singleton. Built-ins registered in strategies/index.ts. */
export const strategyRegistry = new StrategyRegistry();

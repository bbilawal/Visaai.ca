import { Module } from '@nestjs/common';
import { CountriesController } from './countries.controller';

/**
 * Exposes the supported-destination-country reference list (GET /countries).
 * Intentionally guard-free — public reference data; see CountriesController.
 */
@Module({
  controllers: [CountriesController],
})
export class CountriesModule {}

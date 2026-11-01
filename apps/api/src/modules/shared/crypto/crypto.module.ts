import { Global, Module } from '@nestjs/common';
import { FieldCryptoService } from './field-crypto.service';

@Global()
@Module({
  providers: [FieldCryptoService],
  exports: [FieldCryptoService],
})
export class CryptoModule {}

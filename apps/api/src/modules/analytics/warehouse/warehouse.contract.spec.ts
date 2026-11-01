import { IWarehouseProvider } from './warehouse.provider';
import { MockWarehouseProvider } from './mock-warehouse.provider';
import { makeServerEvent } from '../events/catalog';

function runContract(name: string, make: () => IWarehouseProvider) {
  describe(`IWarehouseProvider contract: ${name}`, () => {
    it('writeEvents inserts and dedupes by event_id', async () => {
      const wh = make();
      const e = makeServerEvent('user.registered', { user_id: 'u1' });
      const first = await wh.writeEvents([e]);
      const dup = await wh.writeEvents([e]); // same event_id
      expect(first.inserted).toBe(1);
      expect(dup.inserted).toBe(0);
    });

    it('ensurePartition is idempotent', async () => {
      const wh = make();
      await wh.ensurePartition('2026-07-01');
      await expect(wh.ensurePartition('2026-07-01')).resolves.toBeUndefined();
    });
  });
}

runContract('mock', () => new MockWarehouseProvider());

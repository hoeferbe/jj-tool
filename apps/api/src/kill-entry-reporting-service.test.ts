import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { createKillEntryReport, getHuntingYearRange, getHuntingYearStartYear } from './kill-entry-reporting-service.js';
import type { User } from './auth-store.js';
import type { KillEntry } from './kill-entry-store.js';

const users = [{ id: 'user-1', displayName: 'Jäger Eins' }, { id: 'user-2', displayName: 'Jäger Zwei' }] as User[];

function entry(input: Partial<KillEntry>): KillEntry {
   return {
      id: input.id ?? crypto.randomUUID(),
      revierId: 'revier-1',
      datum: input.datum ?? '2026-04-01',
      wildart: input.wildart ?? 'Reh',
      createdBy: input.createdBy ?? 'user-1',
      createdAt: input.createdAt ?? '2026-04-01T10:00:00.000Z',
      updatedAt: input.updatedAt ?? '2026-04-01T10:00:00.000Z',
      ...input,
   };
}

describe('Kill entry reporting', () => {
   it('uses 1 April through 31 March as the hunting year', () => {
      assert.deepEqual(getHuntingYearRange(2026), { startYear: 2026, from: '2026-04-01', to: '2027-03-31' });
      assert.equal(getHuntingYearStartYear('2027-03-31'), 2026);
      assert.equal(getHuntingYearStartYear('2027-04-01'), 2027);
   });

   it('compares hunting years and groups their species', () => {
      const report = createKillEntryReport([
         entry({ id: 'old', datum: '2025-04-01', wildart: 'Fuchs' }),
         entry({ id: 'current', datum: '2026-03-31', wildart: 'Reh' }),
         entry({ id: 'new', datum: '2026-04-01', wildart: 'Reh' }),
      ], users, { huntingYears: [2025, 2026], from: '2025-04-01', to: '2027-03-31' });

      assert.deepEqual(report.jagdjahre.map((year) => [year.jagdjahr, year.count]), [[2026, 1], [2025, 2]]);
      assert.deepEqual(report.jagdjahre[0]?.wildarten, [{ key: 'Reh', label: 'Reh', count: 1 }]);
   });

   it('maps legacy traffic victims to a fee exemption', () => {
      const report = createKillEntryReport([entry({ istVerkehrsopfer: true, verwertung: undefined })], users, {
         from: '2026-04-01',
         to: '2027-03-31',
      });

      assert.equal(report.kassenwartListe[0]?.kostenfreiArt, 'verkehrsopfer');
      assert.equal(report.kassenwartListe[0]?.verwertung, 'nicht_erfasst');
   });

   it('creates the treasurer list with species, reporter and utilization', () => {
      const report = createKillEntryReport([entry({ wildart: 'Wildschwein', createdBy: 'user-2', verwertung: 'verkauf_gemeinde', kostenfreiArt: 'hegeabschuss' })], users, {
         from: '2026-04-01',
         to: '2027-03-31',
      });

      assert.deepEqual(report.kassenwartListe[0], {
         id: report.kassenwartListe[0]?.id,
         datum: '2026-04-01',
         wildart: 'Wildschwein',
         unterart: undefined,
         melder: 'Jäger Zwei',
         verwertung: 'verkauf_gemeinde',
         kostenfreiArt: 'hegeabschuss',
         gewicht: undefined,
         ortName: undefined,
         notiz: undefined,
      });
   });
});

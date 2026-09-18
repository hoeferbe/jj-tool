import type { User } from './auth-store.js';
import type { KillEntry, KillEntryFeeExemption, KillEntryUtilization } from './kill-entry-store.js';

export interface HuntingYearRange {
   startYear: number;
   from: string;
   to: string;
}

export interface KillEntryReportOptions {
   from?: string;
   to?: string;
   huntingYears?: number[];
}

export interface KillEntryReportGroup {
   key: string;
   label: string;
   count: number;
}

export interface KillEntryReportYear {
   jagdjahr: number;
   from: string;
   to: string;
   count: number;
   wildarten: KillEntryReportGroup[];
}

export interface KillEntryReportEntry {
   id: string;
   datum: string;
   wildart: string;
   unterart?: string;
   melder: string;
   verwertung: KillEntryUtilization | 'nicht_erfasst';
   kostenfreiArt?: KillEntryFeeExemption;
   gewicht?: number;
   ortName?: string;
   notiz?: string;
}

export interface KillEntryReport {
   from: string;
   to: string;
   gesamt: number;
   wildarten: KillEntryReportGroup[];
   melder: KillEntryReportGroup[];
   verwertung: KillEntryReportGroup[];
   jagdjahre: KillEntryReportYear[];
   kassenwartListe: KillEntryReportEntry[];
}

/** Returns the date range represented by a hunting year named by its starting year. */
export function getHuntingYearRange(startYear: number): HuntingYearRange {
   if (!Number.isInteger(startYear) || startYear < 1900 || startYear > 9999) {
      throw new Error('Ungültiges Jagdjahr.');
   }
   return {
      startYear,
      from: `${startYear}-04-01`,
      to: `${startYear + 1}-03-31`,
   };
}

/** Returns the starting year of the hunting year containing an ISO calendar date. */
export function getHuntingYearStartYear(date: string): number {
   const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
   if (!match) throw new Error('Ungültiges Datum.');
   const year = Number(match[1]);
   const month = Number(match[2]);
   const day = Number(match[3]);
   const parsed = new Date(Date.UTC(year, month - 1, day));
   if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
      throw new Error('Ungültiges Datum.');
   }
   return month < 4 ? year - 1 : year;
}

/** Builds grouped rows sorted by descending count and then alphabetically. */
function groupEntries(entries: KillEntry[], keyOf: (entry: KillEntry) => { key: string; label: string }) {
   const groups = new Map<string, KillEntryReportGroup>();
   for (const entry of entries) {
      const key = keyOf(entry);
      const existing = groups.get(key.key);
      if (existing) existing.count += 1;
      else groups.set(key.key, { ...key, count: 1 });
   }
   return [...groups.values()].sort((first, second) => second.count - first.count || first.label.localeCompare(second.label, 'de'));
}

/** Creates all table-oriented summaries for a filtered set of kill entries. */
export function createKillEntryReport(entries: KillEntry[], users: User[], options: KillEntryReportOptions = {}): KillEntryReport {
   const defaultRange = getHuntingYearRange(getHuntingYearStartYear(new Date().toISOString().slice(0, 10)));
   const from = options.from ?? defaultRange.from;
   const to = options.to ?? defaultRange.to;
   if (from > to) throw new Error('Der Zeitraum ist ungültig.');

   const userNames = new Map(users.map((user) => [user.id, user.displayName]));
   const filteredEntries = entries
      .filter((entry) => entry.datum >= from && entry.datum <= to)
      .sort((first, second) => second.datum.localeCompare(first.datum) || second.createdAt.localeCompare(first.createdAt));
   const feeExemptionOf = (entry: KillEntry) => entry.kostenfreiArt ?? (entry.istVerkehrsopfer ? 'verkehrsopfer' : undefined);
   const utilizationOf = (entry: KillEntry) => entry.verwertung ?? 'nicht_erfasst' as const;
   const labelForUtilization = (value: KillEntryUtilization | 'nicht_erfasst') => ({
      eigenverwertung: 'Eigenverwertung',
      verkauf_gemeinde: 'Verkauf innerhalb Gemeinde',
      verkauf_ausserhalb_gemeinde: 'Verkauf außerhalb Gemeinde',
      jagdgemeinschaft_verkauf: 'Jagdgemeinschaft übernimmt Verkauf',
      keine_verwertung: 'Keine Verwertung',
      nicht_erfasst: 'Nicht erfasst',
   }[value]);
   const labelForFeeExemption = (value?: KillEntryFeeExemption) => value === 'verkehrsopfer' ? 'Verkehrsopfer (VO)' : value === 'hegeabschuss' ? 'Hegeabschuss' : undefined;
   const huntingYears = [...new Set([
      ...filteredEntries.map((entry) => getHuntingYearStartYear(entry.datum)),
      ...(options.huntingYears ?? []),
   ])].sort((first, second) => second - first);

   return {
      from,
      to,
      gesamt: filteredEntries.length,
      wildarten: groupEntries(filteredEntries, (entry) => ({ key: entry.wildart, label: entry.wildart })),
      melder: groupEntries(filteredEntries, (entry) => ({ key: entry.createdBy, label: userNames.get(entry.createdBy) ?? 'Unbekanntes Mitglied' })),
      verwertung: groupEntries(filteredEntries, (entry) => {
         const value = utilizationOf(entry);
         return { key: value, label: labelForUtilization(value) };
      }),
      jagdjahre: huntingYears.map((jagdjahr) => {
         const range = getHuntingYearRange(jagdjahr);
         const yearEntries = filteredEntries.filter((entry) => entry.datum >= range.from && entry.datum <= range.to);
         return { jagdjahr, from: range.from, to: range.to, count: yearEntries.length, wildarten: groupEntries(yearEntries, (entry) => ({ key: entry.wildart, label: entry.wildart })) };
      }),
      kassenwartListe: filteredEntries.map((entry) => ({
         id: entry.id,
         datum: entry.datum,
         wildart: entry.wildart,
         unterart: entry.unterart,
         melder: userNames.get(entry.createdBy) ?? 'Unbekanntes Mitglied',
         verwertung: utilizationOf(entry),
         kostenfreiArt: feeExemptionOf(entry),
         gewicht: entry.gewicht,
         ortName: entry.ortName,
         notiz: entry.notiz,
      })),
   };
}

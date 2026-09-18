<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { IonButton, IonIcon, IonNote, IonSelect, IonSelectOption } from '@ionic/vue'
import { printOutline } from 'ionicons/icons'
import AppLayout from '../components/AppLayout.vue'

interface Revier { id: string; name: string; municipalityName: string }
interface ReportGroup { key: string; label: string; count: number }
interface ReportYear { jagdjahr: number; from: string; to: string; count: number; wildarten: ReportGroup[] }
interface ReportEntry {
  id: string
  datum: string
  wildart: string
  unterart?: string
  melder: string
  verwertung: string
  kostenfreiArt?: 'verkehrsopfer' | 'hegeabschuss'
  gewicht?: number
  ortName?: string
  notiz?: string
}
interface Report {
  from: string
  to: string
  gesamt: number
  wildarten: ReportGroup[]
  melder: ReportGroup[]
  verwertung: ReportGroup[]
  jagdjahre: ReportYear[]
  kassenwartListe: ReportEntry[]
}

type ReportMode = 'jagdjahr' | 'zeitraum' | 'vergleich'

const apiUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:8787'
const reviere = ref<Revier[]>([])
const selectedRevierId = ref(localStorage.getItem('jj-member-selected-revier') ?? '')
const mode = ref<ReportMode>('jagdjahr')
const selectedYear = ref(currentHuntingYearStart())
const selectedYears = ref<number[]>([selectedYear.value, selectedYear.value - 1])
const from = ref('')
const to = ref('')
const report = ref<Report | null>(null)
const loading = ref(true)
const errorMessage = ref('')

const selectedRevier = computed(() => reviere.value.find((revier) => revier.id === selectedRevierId.value) ?? null)
const yearOptions = computed(() => Array.from({ length: 6 }, (_, index) => currentHuntingYearStart() - index))

/** Returns the start year of the current hunting year. */
function currentHuntingYearStart() {
  const today = new Date()
  return today.getMonth() < 3 ? today.getFullYear() - 1 : today.getFullYear()
}

/** Returns the ISO range for a hunting year. */
function huntingYearRange(year: number) {
  return { from: `${year}-04-01`, to: `${year + 1}-03-31` }
}

/** Formats an ISO date for German display. */
function formatDate(value: string) {
  return new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium' }).format(new Date(`${value}T12:00:00`))
}

/** Formats a utilization value returned by the reporting API. */
function utilizationLabel(value: string) {
  return {
    eigenverwertung: 'Eigenverwertung',
    verkauf_gemeinde: 'Verkauf innerhalb Gemeinde',
    verkauf_ausserhalb_gemeinde: 'Verkauf außerhalb Gemeinde',
    jagdgemeinschaft_verkauf: 'Jagdgemeinschaft übernimmt Verkauf',
    keine_verwertung: 'Keine Verwertung',
    nicht_erfasst: 'Nicht erfasst',
  }[value] ?? value
}

/** Opens the browser print dialog for saving the current report as a PDF. */
function printReport() {
  if (!report.value) return
  window.print()
}

/** Builds the API query for the active report mode. */
function reportQuery() {
  if (mode.value === 'jagdjahr') {
    const range = huntingYearRange(selectedYear.value)
    return new URLSearchParams({ von: range.from, bis: range.to, jagdjahre: String(selectedYear.value) })
  }
  if (mode.value === 'zeitraum') {
    return new URLSearchParams({ von: from.value, bis: to.value })
  }
  const years = [...selectedYears.value].sort((left, right) => left - right)
  const first = huntingYearRange(years[0] ?? selectedYear.value)
  const last = huntingYearRange(years[years.length - 1] ?? selectedYear.value)
  return new URLSearchParams({ von: first.from, bis: last.to, jagdjahre: years.join(',') })
}

/** Loads the user's hunting districts and selects the saved district if available. */
async function loadReviere() {
  const token = localStorage.getItem('accessToken')
  try {
    const response = await fetch(`${apiUrl}/reviere`, { headers: { Authorization: `Bearer ${token}` } })
    const data = await response.json() as { reviere?: Revier[]; message?: string }
    if (!response.ok) throw new Error(data.message ?? 'Reviere konnten nicht geladen werden.')
    reviere.value = data.reviere ?? []
    if (!reviere.value.some((revier) => revier.id === selectedRevierId.value)) {
      selectedRevierId.value = reviere.value[0]?.id ?? ''
      if (selectedRevierId.value) localStorage.setItem('jj-member-selected-revier', selectedRevierId.value)
    }
    await loadReport()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Reviere konnten nicht geladen werden.'
    loading.value = false
  }
}

/** Loads the current report using the selected district and filter mode. */
async function loadReport() {
  if (!selectedRevierId.value) {
    loading.value = false
    return
  }
  loading.value = true
  errorMessage.value = ''
  try {
    const query = reportQuery()
    if (!query.get('von') || !query.get('bis')) throw new Error('Bitte einen vollständigen Zeitraum auswählen.')
    const token = localStorage.getItem('accessToken')
    const response = await fetch(`${apiUrl}/reviere/${selectedRevierId.value}/streckeneintraege/auswertung?${query.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    })
    const data = await response.json() as { auswertung?: Report; message?: string }
    if (!response.ok || !data.auswertung) throw new Error(data.message ?? 'Auswertung konnte nicht geladen werden.')
    report.value = data.auswertung
  } catch (error) {
    report.value = null
    errorMessage.value = error instanceof Error ? error.message : 'Auswertung konnte nicht geladen werden.'
  } finally {
    loading.value = false
  }
}

/** Toggles one hunting year in the comparison selection. */
function toggleYear(year: number) {
  if (selectedYears.value.includes(year)) {
    if (selectedYears.value.length > 1) selectedYears.value = selectedYears.value.filter((value) => value !== year)
  } else {
    selectedYears.value = [...selectedYears.value, year]
  }
}

watch([selectedRevierId, mode, selectedYear, selectedYears, from, to], () => {
  if (mode.value !== 'zeitraum' || (from.value && to.value)) void loadReport()
}, { deep: true })

onMounted(loadReviere)
</script>

<template>
  <AppLayout>
    <div class="page-content">
      <div class="page-heading">
        <div>
          <h1>Streckenauswertung</h1>
          <p v-if="selectedRevier">{{ selectedRevier.name }} · {{ selectedRevier.municipalityName }}</p>
        </div>
        <div class="heading-actions">
          <IonSelect v-if="reviere.length > 1" :value="selectedRevierId" label="Revier" label-placement="stacked" interface="popover" @ion-change="selectedRevierId = $event.detail.value">
            <IonSelectOption v-for="revier in reviere" :key="revier.id" :value="revier.id">{{ revier.name }}</IonSelectOption>
          </IonSelect>
          <IonButton fill="outline" :disabled="!report || loading" @click="printReport">
            <IonIcon slot="start" :icon="printOutline" />
            PDF drucken
          </IonButton>
        </div>
      </div>

      <section class="filter-panel">
        <div class="mode-tabs" role="tablist" aria-label="Auswertungszeitraum">
          <button v-for="option in [{ value: 'jagdjahr', label: 'Jagdjahr' }, { value: 'zeitraum', label: 'Freier Zeitraum' }, { value: 'vergleich', label: 'Jahresvergleich' }]" :key="option.value" type="button" class="mode-tab" :class="{ active: mode === option.value }" @click="mode = option.value as ReportMode">
            {{ option.label }}
          </button>
        </div>
        <div v-if="mode === 'jagdjahr'" class="filter-fields">
          <label>Jagdjahr
            <select v-model.number="selectedYear" class="form-control">
              <option v-for="year in yearOptions" :key="year" :value="year">{{ year }}/{{ year + 1 }}</option>
            </select>
          </label>
        </div>
        <div v-else-if="mode === 'zeitraum'" class="filter-fields">
          <label>Von <input v-model="from" class="form-control" type="date"></label>
          <label>Bis <input v-model="to" class="form-control" type="date"></label>
        </div>
        <div v-else class="year-selection">
          <span class="filter-label">Jagdjahre vergleichen</span>
          <label v-for="year in yearOptions" :key="year" class="year-option">
            <input type="checkbox" :checked="selectedYears.includes(year)" @change="toggleYear(year)">
            {{ year }}/{{ year + 1 }}
          </label>
        </div>
        <IonButton fill="outline" @click="loadReport">Aktualisieren</IonButton>
      </section>

      <p v-if="errorMessage" class="error-message">{{ errorMessage }}</p>
      <IonNote v-if="loading">Auswertung wird geladen...</IonNote>
      <template v-else-if="report">
        <p class="period-note print-title">{{ selectedRevier?.name ?? 'Revier' }} · Streckenauswertung</p>
        <p class="period-note">Zeitraum: {{ formatDate(report.from) }} bis {{ formatDate(report.to) }} · {{ report.gesamt }} Einträge</p>

        <section class="report-section">
          <h2>Zusammenfassung</h2>
          <div class="summary-grid">
            <div><strong>{{ report.gesamt }}</strong><span>Gesamt</span></div>
            <div><strong>{{ report.wildarten.length }}</strong><span>Wildarten</span></div>
            <div><strong>{{ report.melder.length }}</strong><span>Melder</span></div>
          </div>
          <div class="table-grid">
            <div><h3>Nach Wildart</h3><table><tbody><tr v-for="row in report.wildarten" :key="row.key"><td>{{ row.label }}</td><td>{{ row.count }}</td></tr></tbody></table></div>
            <div><h3>Nach Verwertung</h3><table><tbody><tr v-for="row in report.verwertung" :key="row.key"><td>{{ row.label }}</td><td>{{ row.count }}</td></tr></tbody></table></div>
            <div><h3>Nach Melder</h3><table><tbody><tr v-for="row in report.melder" :key="row.key"><td>{{ row.label }}</td><td>{{ row.count }}</td></tr></tbody></table></div>
          </div>
        </section>

        <section class="report-section">
          <h2>Jagdjahrvergleich</h2>
          <table class="data-table"><thead><tr><th>Jagdjahr</th><th>Zeitraum</th><th>Gesamt</th><th>Wildarten</th></tr></thead><tbody><tr v-for="year in report.jagdjahre" :key="year.jagdjahr"><td>{{ year.jagdjahr }}/{{ year.jagdjahr + 1 }}</td><td>{{ formatDate(year.from) }} bis {{ formatDate(year.to) }}</td><td>{{ year.count }}</td><td>{{ year.wildarten.map((row) => `${row.label}: ${row.count}`).join(', ') || 'Keine Einträge' }}</td></tr></tbody></table>
        </section>

        <section class="report-section">
          <h2>Kassenwart-Liste</h2>
          <table class="data-table"><thead><tr><th>Datum</th><th>Wildart</th><th>Melder</th><th>Verwertung</th><th>Kostenfrei</th><th>Gewicht</th></tr></thead><tbody><tr v-for="entry in report.kassenwartListe" :key="entry.id"><td>{{ formatDate(entry.datum) }}</td><td>{{ entry.wildart }}<span v-if="entry.unterart" class="sub-detail">{{ entry.unterart }}</span></td><td>{{ entry.melder }}</td><td>{{ utilizationLabel(entry.verwertung) }}</td><td><span v-if="entry.kostenfreiArt" class="free-label">{{ entry.kostenfreiArt === 'verkehrsopfer' ? 'VO' : 'Hegeabschuss' }}</span><span v-else>-</span></td><td>{{ entry.gewicht !== undefined ? `${entry.gewicht} kg` : '-' }}</td></tr></tbody></table>
          <IonNote v-if="!report.kassenwartListe.length">Keine Einträge im gewählten Zeitraum.</IonNote>
        </section>
      </template>
    </div>
  </AppLayout>
</template>

<style scoped>
.page-content { padding: 20px; max-width: 1180px; margin: 0 auto; }
.page-heading { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; margin-bottom: 20px; flex-wrap: wrap; }
.heading-actions { display: flex; align-items: end; gap: 12px; flex-wrap: wrap; }
.page-heading h1 { margin: 0 0 4px; font-size: 1.75rem; }
.page-heading p, .period-note { margin: 0; color: var(--ion-color-medium, #666); }
.filter-panel { display: flex; align-items: end; flex-wrap: wrap; gap: 16px; padding: 16px; margin-bottom: 20px; border: 1px solid var(--ion-color-light-shade, #dfe3dc); background: var(--ion-color-light, #f7f8f4); border-radius: 8px; }
.mode-tabs { display: flex; gap: 4px; flex-wrap: wrap; }
.mode-tab { border: 1px solid var(--ion-color-medium-tint, #b7bdb4); background: white; padding: 9px 12px; cursor: pointer; }
.mode-tab.active { background: var(--ion-color-primary, #2f6b32); color: white; border-color: var(--ion-color-primary, #2f6b32); }
.filter-fields, .year-selection { display: flex; align-items: end; gap: 12px; flex-wrap: wrap; }
.filter-fields label, .filter-label { display: flex; flex-direction: column; gap: 5px; font-size: .85rem; font-weight: 600; }
.form-control { min-height: 38px; padding: 7px 10px; border: 1px solid #bcc4b8; border-radius: 4px; background: white; color: inherit; }
.year-option { display: flex; align-items: center; gap: 5px; font-size: .9rem; white-space: nowrap; }
.error-message { color: var(--ion-color-danger, #eb445a); }
.report-section { margin-top: 24px; }
.report-section h2 { margin-bottom: 12px; }
.report-section h3 { margin: 0 0 8px; font-size: 1rem; }
.summary-grid { display: grid; grid-template-columns: repeat(3, minmax(100px, 1fr)); gap: 10px; margin-bottom: 18px; }
.summary-grid div { padding: 14px; border: 1px solid #dfe3dc; background: #fff; border-radius: 6px; }
.summary-grid strong, .summary-grid span { display: block; }
.summary-grid strong { font-size: 1.5rem; }
.summary-grid span { color: var(--ion-color-medium, #666); font-size: .85rem; }
.table-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
table { width: 100%; border-collapse: collapse; background: white; }
th, td { padding: 9px 10px; border-bottom: 1px solid #e3e6e0; text-align: left; vertical-align: top; }
th { background: #eef1e7; font-size: .8rem; text-transform: uppercase; }
th:not(:first-child), td:not(:first-child) { text-align: right; }
.data-table th:not(:first-child), .data-table td:not(:first-child) { text-align: left; }
.sub-detail { display: block; color: var(--ion-color-medium, #666); font-size: .8rem; }
.free-label { color: #8a6100; font-weight: 600; }
@media (max-width: 760px) { .table-grid { grid-template-columns: 1fr; } .summary-grid { grid-template-columns: repeat(3, 1fr); } .data-table { display: block; overflow-x: auto; white-space: nowrap; } }

.print-title { display: none; }

@media print {
  @page { size: A4 portrait; margin: 14mm; }
  :global(body) { background: #fff !important; }
  :global(ion-header), :global(.motd), :global(.offline-banner), .filter-panel, .error-message, :global(ion-note), .heading-actions { display: none !important; }
  .page-content { max-width: none; padding: 0; margin: 0; }
  .page-heading { display: block; margin: 0 0 14px; }
  .page-heading h1 { font-size: 20pt; }
  .page-heading p { color: #222; }
  .print-title { display: block; color: #222; font-size: 12pt; font-weight: 600; margin-top: 10px; }
  .period-note { color: #222; font-size: 9pt; }
  .report-section { margin-top: 16px; break-inside: avoid; }
  .report-section h2 { font-size: 13pt; }
  .table-grid { grid-template-columns: repeat(3, 1fr); gap: 8px; }
  .summary-grid { gap: 8px; }
  .summary-grid div { padding: 8px; }
  .summary-grid strong { font-size: 13pt; }
  th, td { padding: 5px 6px; font-size: 8pt; }
  th { background: #eef1e7 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .data-table { break-inside: auto; }
  .data-table tr { break-inside: avoid; }
  .data-table thead { display: table-header-group; }
}
</style>

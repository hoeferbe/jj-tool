<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import * as L from 'leaflet'
import { IonButton, IonContent, IonInput, IonItem, IonList, IonModal, IonNote, IonSelect, IonSelectOption } from '@ionic/vue'
import BkgAttribution from './BkgAttribution.vue'

interface Boundary {
  type: 'FeatureCollection'
  features: Array<{ type: 'Feature'; properties?: Record<string, unknown>; geometry: { type: string; coordinates: unknown } }>
}

interface CreatedRevier {
  id: string
  name: string
  municipalityName: string
  municipalityCode?: string
  center: { lat: number; lng: number }
  boundary: Boundary
  source: 'bkg-wfs-vg25'
  createdBy: string
  createdAt: string
  updatedAt: string
}

const props = defineProps<{ isOpen: boolean }>()
const emit = defineEmits<{ close: []; created: [revier: CreatedRevier] }>()
const apiUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:8787'
const mapContainer = ref<HTMLElement | null>(null)
const name = ref('')
const query = ref('')
const suggestions = ref<Array<{ name: string; code?: string }>>([])
const suggestionsLoading = ref(false)
const state = ref('')
const municipalityName = ref('')
const municipalityCode = ref('')
const boundary = ref<Boundary | null>(null)
const center = ref<{ lat: number; lng: number } | null>(null)
const searching = ref(false)
const saving = ref(false)
const locating = ref(false)
const selectionMode = ref(false)
const message = ref('')
let map: L.Map | null = null
let boundaryLayer: L.GeoJSON | null = null
let clickMarker: L.CircleMarker | null = null
let userChangedMapView = false
let suggestionTimer: ReturnType<typeof setTimeout> | null = null

const states = [
  ['Schleswig-Holstein', 54.2, 9.8, 7], ['Hamburg', 53.55, 10, 10],
  ['Niedersachsen', 52.8, 9.2, 7], ['Bremen', 53.08, 8.8, 10],
  ['Nordrhein-Westfalen', 51.45, 7.55, 7], ['Hessen', 50.6, 9, 8],
  ['Rheinland-Pfalz', 49.9, 7.45, 8], ['Baden-Württemberg', 48.65, 9, 7],
  ['Bayern', 48.95, 11.4, 7], ['Saarland', 49.38, 6.95, 9],
  ['Berlin', 52.52, 13.4, 10], ['Brandenburg', 52.4, 13.4, 7],
  ['Mecklenburg-Vorpommern', 53.75, 12.5, 7], ['Sachsen', 51, 13.4, 8],
  ['Sachsen-Anhalt', 51.95, 11.7, 8], ['Thüringen', 50.9, 11, 8],
] as const

const canCreate = computed(() => name.value.trim().length >= 2 && boundary.value && center.value)

function reset() {
  name.value = ''
  query.value = ''
  suggestions.value = []
  suggestionsLoading.value = false
  state.value = ''
  municipalityName.value = ''
  municipalityCode.value = ''
  boundary.value = null
  center.value = null
  message.value = ''
  selectionMode.value = false
  mapContainer.value?.classList.remove('selection-mode')
  boundaryLayer = null
  clickMarker = null
  userChangedMapView = false
}

async function initializeMap() {
  reset()
  await nextTick()
  if (!mapContainer.value) return
  map?.remove()
  map = L.map(mapContainer.value, { zoomSnap: 0.1, zoomDelta: 0.5 }).setView([51.1657, 10.4515], 6)
  const streets = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap contributors' })
  const satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: 'Tiles &copy; Esri' })
  streets.addTo(map)
  L.control.layers({ Straßenkarte: streets, Satellit: satellite }).addTo(map)
  map.on('dragstart zoomstart', () => { userChangedMapView = true })
  map.on('click', (event: L.LeafletMouseEvent) => {
    if (!selectionMode.value && !event.originalEvent.metaKey && !event.originalEvent.ctrlKey) return
    userChangedMapView = true
    setSelectionMode(false)
    if (clickMarker) map?.removeLayer(clickMarker)
    clickMarker = L.circleMarker(event.latlng, {
      radius: 7,
      color: '#ffffff',
      weight: 2,
      fillColor: '#2f6b32',
      fillOpacity: 1,
    }).addTo(map!)
    searchByPoint(event.latlng.lat, event.latlng.lng)
  })
  requestAnimationFrame(() => map?.invalidateSize())
  locateUser()
}

function setSelectionMode(active: boolean) {
  selectionMode.value = active
  mapContainer.value?.classList.toggle('selection-mode', active)
}

function locateUser() {
  if (!navigator.geolocation || !map) return
  locating.value = true
  navigator.geolocation.getCurrentPosition(
    (position) => {
      if (!userChangedMapView) {
        map?.setView([position.coords.latitude, position.coords.longitude], 10)
      }
      locating.value = false
    },
    () => { locating.value = false },
    { enableHighAccuracy: false, timeout: 5000, maximumAge: 300000 },
  )
}

function selectState(value: string) {
  userChangedMapView = true
  state.value = value
  if (!value) {
    map?.setView([51.1657, 10.4515], 6)
    return
  }
  const selected = states.find(([name]) => name === value)
  if (selected) map?.setView([selected[1], selected[2]], selected[3])
}

async function searchMunicipality(params: URLSearchParams) {
  searching.value = true
  message.value = ''
  const token = localStorage.getItem('accessToken')
  try {
    const response = await fetch(`${apiUrl}/municipalities/search?${params}`, { headers: { Authorization: `Bearer ${token}` } })
    const data = await response.json() as { municipalityName?: string; municipalityCode?: string; boundary?: Boundary; message?: string }
    if (!response.ok || !data.boundary) throw new Error(data.message ?? 'Gemeinde konnte nicht gefunden werden.')
    municipalityName.value = data.municipalityName ?? 'Gemeinde'
    municipalityCode.value = data.municipalityCode ?? ''
    boundary.value = data.boundary
    boundaryLayer && map?.removeLayer(boundaryLayer)
    boundaryLayer = L.geoJSON(data.boundary, { style: { color: '#2f6b32', weight: 3, fillColor: '#2dd36f', fillOpacity: 0.12 } }).addTo(map!)
    const bounds = boundaryLayer.getBounds()
    if (bounds.isValid()) {
      const mapCenter = bounds.getCenter()
      center.value = { lat: mapCenter.lat, lng: mapCenter.lng }
    }
    requestAnimationFrame(() => {
      map?.invalidateSize({ pan: false })
      if (bounds.isValid() && map) {
        const size = map.getSize()
        map.fitBounds(bounds, {
          padding: L.point(Math.round(size.x * 0.05), Math.round(size.y * 0.05)),
          maxZoom: 15,
        })
      }
      boundaryLayer?.bringToFront()
      clickMarker?.bringToFront()
    })
  } catch (error) {
    message.value = (error as Error).message
  } finally {
    searching.value = false
  }
}

function searchByName() {
  if (!query.value.trim()) return
  suggestions.value = []
  userChangedMapView = true
  const params = new URLSearchParams({ name: query.value.trim() })
  if (state.value) params.set('state', state.value)
  searchMunicipality(params)
}

async function loadSuggestions(searchTerm: string) {
  suggestionsLoading.value = true
  const token = localStorage.getItem('accessToken')
  try {
    const params = new URLSearchParams({ name: searchTerm, suggest: 'true' })
    if (state.value) params.set('state', state.value)
    const response = await fetch(`${apiUrl}/municipalities/search?${params}`, { headers: { Authorization: `Bearer ${token}` } })
    const data = await response.json() as { suggestions?: Array<{ name: string; code?: string }> }
    if (query.value.trim() === searchTerm) suggestions.value = response.ok ? data.suggestions ?? [] : []
  } catch {
    if (query.value.trim() === searchTerm) suggestions.value = []
  } finally {
    if (query.value.trim() === searchTerm) suggestionsLoading.value = false
  }
}

function selectSuggestion(suggestion: { name: string }) {
  query.value = suggestion.name
  searchByName()
}

watch([query, state], ([value]) => {
  if (suggestionTimer) clearTimeout(suggestionTimer)
  const searchTerm = value.trim()
  if (searchTerm.length < 2) {
    suggestions.value = []
    suggestionsLoading.value = false
    return
  }
  suggestionsLoading.value = true
  suggestionTimer = setTimeout(() => loadSuggestions(searchTerm), 250)
})

function searchByPoint(lat: number, lng: number) {
  searchMunicipality(new URLSearchParams({ lat: String(lat), lng: String(lng) }))
}

async function createRevier() {
  if (!canCreate.value || !boundary.value || !center.value) return
  saving.value = true
  const token = localStorage.getItem('accessToken')
  try {
    const response = await fetch(`${apiUrl}/reviere`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name.value.trim(), municipalityName: municipalityName.value,
        municipalityCode: municipalityCode.value || undefined, center: center.value,
        boundary: boundary.value, source: 'bkg-wfs-vg25',
      }),
    })
    const data = await response.json() as { revier?: CreatedRevier; message?: string }
    if (!response.ok || !data.revier) throw new Error(data.message ?? 'Revier konnte nicht angelegt werden.')
    const refreshResponse = await fetch(`${apiUrl}/auth/refresh`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
    if (refreshResponse.ok) {
      const refreshed = await refreshResponse.json() as { accessToken?: string }
      if (refreshed.accessToken) {
        localStorage.setItem('accessToken', refreshed.accessToken)
        window.dispatchEvent(new Event('auth-changed'))
      }
    }
    emit('created', data.revier)
    emit('close')
  } catch (error) {
    message.value = (error as Error).message
  } finally {
    saving.value = false
  }
}

function close() {
  map?.remove()
  map = null
  emit('close')
}
</script>

<template>
  <IonModal class="revier-modal" :is-open="props.isOpen" @did-present="initializeMap" @did-dismiss="close">
    <IonContent class="dialog-scroll">
      <div class="dialog-content">
      <div class="dialog-heading">
        <h2>Neues Revier</h2>
        <IonButton fill="clear" @click="close">Schließen</IonButton>
      </div>
      <section class="form-section">
        <IonInput v-model="name" label="Reviername" label-placement="stacked" placeholder="z. B. Nordrevier" />
        <IonNote>Als Ersteller wirst du in diesem Revier Pächter und Revieradmin.</IonNote>
      </section>
      <section class="form-section">
        <h3>Standort</h3>
        <div class="location-controls">
          <IonSelect :value="state" label="Bundesland" label-placement="stacked" interface="popover" placeholder="Deutschland" @ion-change="selectState($event.detail.value)">
            <IonSelectOption value="">Deutschland</IonSelectOption>
            <IonSelectOption v-for="entry in states" :key="entry[0]" :value="entry[0]">{{ entry[0] }}</IonSelectOption>
          </IonSelect>
          <IonButton fill="outline" :disabled="locating" @click="locateUser">{{ locating ? 'Standort...' : 'Mein Standort' }}</IonButton>
        </div>
        <div class="search-controls">
          <IonInput v-model="query" label="Gemeinde suchen" label-placement="stacked" placeholder="Name der Gemeinde" @keyup.enter="searchByName" />
          <IonButton :disabled="searching || !query.trim()" @click="searchByName">{{ searching ? 'Suche...' : 'Suchen' }}</IonButton>
        </div>
        <IonNote v-if="suggestionsLoading">Passende Gemeinden werden gesucht...</IonNote>
        <IonList v-else-if="suggestions.length" class="suggestion-list" lines="full">
          <IonItem v-for="suggestion in suggestions" :key="suggestion.code ?? suggestion.name" button detail @click="selectSuggestion(suggestion)">
            {{ suggestion.name }}
          </IonItem>
        </IonList>
      </section>
      <section class="form-section map-section">
        <div class="map-section-heading">
          <div><h3>Gemeinde auf Karte wählen</h3><IonNote>Klicke auf die Karte, um die Gemeinde an dieser Position zu übernehmen.</IonNote></div>
          <IonButton size="small" :fill="selectionMode ? 'solid' : 'outline'" :color="selectionMode ? 'success' : 'primary'" @click="setSelectionMode(!selectionMode)">{{ selectionMode ? 'Auswahl aktiv' : 'Auf Karte wählen' }}</IonButton>
        </div>
        <IonNote v-if="selectionMode">Klicke jetzt auf den gewünschten Punkt.</IonNote>
        <IonNote v-else>Alternativ: Strg-/⌘-Klick auf die Karte.</IonNote>
      <div v-if="boundary" class="selection">
        <span>Ausgewählte Gemeinde</span>
        <strong>{{ municipalityName }}</strong>
        <small v-if="municipalityCode">Gemeindecode {{ municipalityCode }}</small>
      </div>
      <div ref="mapContainer" class="creation-map"></div>
      <BkgAttribution v-if="boundary" :year="new Date().getFullYear()" />
      </section>
      <p v-if="message" class="message">{{ message }}</p>
      <div class="dialog-actions">
        <IonButton fill="clear" :disabled="saving" @click="close">Abbrechen</IonButton>
        <IonButton :disabled="saving || !canCreate" @click="createRevier">{{ saving ? 'Anlegen...' : 'Revier anlegen' }}</IonButton>
      </div>
      </div>
    </IonContent>
  </IonModal>
</template>

<style scoped>
.dialog-content { display: flex; flex-direction: column; gap: 16px; min-height: 100%; box-sizing: border-box; padding: 22px; }
.dialog-heading, .location-controls, .search-controls, .dialog-actions, .map-section-heading { display: flex; align-items: end; gap: 12px; }
.dialog-heading { justify-content: space-between; }
.dialog-heading h2, .form-section h3 { margin: 0; }
.form-section { display: flex; flex-direction: column; gap: 12px; }
.location-controls ion-select, .search-controls ion-input { flex: 1; }
.suggestion-list { margin-top: -4px; border: 1px solid var(--ion-color-light-shade); border-radius: 8px; overflow: hidden; }
.map-section-heading { align-items: center; justify-content: space-between; }
.creation-map { width: 100%; height: min(520px, 48vh); border: 1px solid var(--ion-color-light-shade); border-radius: 8px; overflow: hidden; }
.creation-map.selection-mode { cursor: crosshair !important; box-shadow: 0 0 0 3px rgba(45, 211, 111, 0.35); }
.creation-map.selection-mode :deep(.leaflet-pane) { cursor: crosshair !important; }
.selection { display: grid; grid-template-columns: auto 1fr auto; align-items: baseline; gap: 8px 12px; padding: 10px 12px; border-left: 3px solid var(--ion-color-success); background: rgba(63, 106, 66, 0.08); }
.selection span, .selection small { color: var(--ion-color-medium-shade); }
.message { color: var(--ion-color-danger); }
.dialog-actions { justify-content: flex-end; padding-top: 4px; border-top: 1px solid var(--ion-color-light-shade); }
:global(.revier-modal) { --width: min(900px, calc(100vw - 24px)); --height: min(900px, 94vh); --max-height: 94vh; --border-radius: 10px; }
:global(.revier-modal ion-content) { --background: var(--ion-background-color, #f8f8f2); }
@media (max-width: 560px) {
  .dialog-content { padding: 18px; gap: 14px; }
  .location-controls, .search-controls, .map-section-heading { align-items: stretch; flex-direction: column; }
  .location-controls ion-select, .search-controls ion-input, .map-section-heading ion-button { width: 100%; }
  .dialog-actions ion-button { flex: 1; }
  .selection { grid-template-columns: 1fr; gap: 3px; }
}
</style>
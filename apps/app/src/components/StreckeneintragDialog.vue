<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { IonButton, IonContent, IonModal, IonNote } from '@ionic/vue'
import * as L from 'leaflet'
import ImageGallery from './ImageGallery.vue'
import { submitOrQueue } from '../composables/useOfflineQueue'

interface Point { lat: number; lng: number }

interface GeoJsonFeatureCollection {
  type: 'FeatureCollection'
  features: Array<{
    type: 'Feature'
    properties?: Record<string, unknown>
    geometry: { type: string; coordinates: unknown }
  }>
}

export type KillEntryGender = 'maennlich' | 'weiblich' | 'unbekannt'
export type KillEntryUtilization = 'eigenverwertung' | 'verkauf_gemeinde' | 'verkauf_ausserhalb_gemeinde' | 'jagdgemeinschaft_verkauf' | 'keine_verwertung'
export type KillEntryFeeExemption = 'verkehrsopfer' | 'hegeabschuss'

export interface Streckeneintrag {
  id: string
  revierId: string
  datum: string
  uhrzeit?: string
  wildart: string
  unterart?: string
  geschlecht?: KillEntryGender
  verwertung?: KillEntryUtilization
  kostenfreiArt?: KillEntryFeeExemption
  istVerkehrsopfer?: boolean
  bescheinigung?: boolean
  ortName?: string
  position?: Point
  gewicht?: number
  geschaetztesAlter?: string
  notiz?: string
  createdBy: string
  createdByName?: string
  createdAt: string
  updatedAt?: string
}

const props = withDefaults(defineProps<{
  isOpen: boolean
  revierId: string
  entry?: Streckeneintrag | null
  revierCenter?: Point
  revierBoundary?: GeoJsonFeatureCollection
}>(), {})

const emit = defineEmits<{
  close: []
  saved: [entry: Streckeneintrag]
}>()

const apiUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:8787'

function getCurrentDateStr() {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function getCurrentTimeStr() {
  const now = new Date()
  const hours = String(now.getHours()).padStart(2, '0')
  const minutes = String(now.getMinutes()).padStart(2, '0')
  return `${hours}:${minutes}`
}

const datum = ref(getCurrentDateStr())
const uhrzeit = ref(getCurrentTimeStr())
const wildart = ref('')
const unterart = ref('')
const geschlecht = ref<KillEntryGender | ''>('')
const verwertung = ref<KillEntryUtilization | ''>('eigenverwertung')
const kostenfreiArt = ref<KillEntryFeeExemption | ''>('')
const istVerkehrsopfer = ref(false)
const keineBescheinigung = ref(false)
const ortName = ref('')
const position = ref<Point | null>(null)
const gewicht = ref<number | null>(null)
const geschaetztesAlter = ref('')
const notiz = ref('')

const saving = ref(false)
const message = ref('')
const gpsLoading = ref(false)
const showMapPicker = ref(false)

const mapContainer = ref<HTMLElement | null>(null)
let mapInstance: L.Map | null = null
let markerInstance: L.Marker | null = null
let boundaryLayerInstance: L.GeoJSON | null = null
const mapLayerStorageKey = 'jj-revier-map-layer'

const commonWildarten = ['Reh', 'Wildschwein', 'Fuchs', 'Fasan', 'Hase', 'Dachs', 'Waschbär', 'Damwild', 'Rotwild']

const isRehwild = computed(() => {
  const w = wildart.value.toLowerCase().trim()
  return w.includes('reh')
})

const isSchwarzwild = computed(() => {
  const w = wildart.value.toLowerCase().trim()
  return w.includes('schwein') || w.includes('sau') || w.includes('schwarz')
})

const isRotwildOrDamwild = computed(() => {
  const w = wildart.value.toLowerCase().trim()
  return w.includes('rot') || w.includes('dam') || w.includes('hirsch')
})

const isFuchs = computed(() => {
  const w = wildart.value.toLowerCase().trim()
  return w.includes('fuchs')
})

watch(istVerkehrsopfer, (isVo) => {
  if (isVo && !kostenfreiArt.value) kostenfreiArt.value = 'verkehrsopfer'
  if (!isVo && kostenfreiArt.value === 'verkehrsopfer') kostenfreiArt.value = ''
})

/** Builds the red drop-pin marker icon used for the kill entry position. */
function createKillMarker(latLng: L.LatLngExpression) {
  const icon = L.divIcon({
    className: 'kill-marker-icon-container',
    html: `
      <div class="kill-pin-wrapper">
        <svg viewBox="0 0 24 24" class="kill-pin-svg">
          <path fill="#e63946" stroke="#ffffff" stroke-width="1.5" d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/>
          <circle cx="12" cy="9" r="3.2" fill="#ffffff"/>
        </svg>
      </div>
    `,
    iconSize: [32, 32],
    iconAnchor: [16, 32],
    popupAnchor: [0, -32],
  })
  return L.marker(latLng, { icon, draggable: true })
}

function selectRehCategory(cat: { unterart: string; geschlecht: KillEntryGender }) {
  unterart.value = cat.unterart
  geschlecht.value = cat.geschlecht
}

function selectWildart(w: string) {
  wildart.value = w
}

/** Ray-casting point-in-polygon test for a single ring of coordinates. */
function pointInRing(lat: number, lng: number, ring: number[][]) {
  let inside = false
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const [currentLng, currentLat] = ring[index] ?? []
    const [previousLng, previousLat] = ring[previous] ?? []
    if (currentLng === undefined || currentLat === undefined || previousLng === undefined || previousLat === undefined) continue
    const intersects = (currentLat > lat) !== (previousLat > lat)
      && lng < ((previousLng - currentLng) * (lat - currentLat)) / (previousLat - currentLat) + currentLng
    if (intersects) inside = !inside
  }
  return inside
}

/** Whether a point lies inside the Revier boundary (Polygon/MultiPolygon); `true` if no boundary is given. */
function pointInBoundary(boundary: GeoJsonFeatureCollection, lat: number, lng: number) {
  if (!boundary || !boundary.features || !boundary.features.length) return true
  return boundary.features.some((feature) => {
    if (feature.geometry.type === 'Polygon') {
      const rings = feature.geometry.coordinates as number[][][]
      return Boolean(rings[0] && pointInRing(lat, lng, rings[0]) && !rings.slice(1).some((ring) => pointInRing(lat, lng, ring)))
    }
    if (feature.geometry.type === 'MultiPolygon') {
      return (feature.geometry.coordinates as number[][][][]).some((polygon) =>
        Boolean(polygon[0] && pointInRing(lat, lng, polygon[0]) && !polygon.slice(1).some((ring) => pointInRing(lat, lng, ring))),
      )
    }
    return false
  })
}

/** Fills the form from `props.entry` when editing, or clears it (and tries GPS) for a new entry. */
function reset() {
  if (props.entry) {
    datum.value = props.entry.datum
    uhrzeit.value = props.entry.uhrzeit ?? getCurrentTimeStr()
    wildart.value = props.entry.wildart
    unterart.value = props.entry.unterart ?? ''
    geschlecht.value = props.entry.geschlecht ?? ''
    verwertung.value = props.entry.verwertung ?? ''
    kostenfreiArt.value = props.entry.kostenfreiArt ?? (props.entry.istVerkehrsopfer ? 'verkehrsopfer' : '')
    istVerkehrsopfer.value = Boolean(props.entry.istVerkehrsopfer)
    keineBescheinigung.value = Boolean(props.entry.istVerkehrsopfer && props.entry.bescheinigung === false)
    ortName.value = props.entry.ortName ?? ''
    position.value = props.entry.position ? { ...props.entry.position } : null
    gewicht.value = props.entry.gewicht ?? null
    geschaetztesAlter.value = props.entry.geschaetztesAlter ?? ''
    notiz.value = props.entry.notiz ?? ''
  } else {
    datum.value = getCurrentDateStr()
    uhrzeit.value = getCurrentTimeStr()
    wildart.value = ''
    unterart.value = ''
    geschlecht.value = ''
    verwertung.value = 'eigenverwertung'
    kostenfreiArt.value = ''
    istVerkehrsopfer.value = false
    keineBescheinigung.value = false
    ortName.value = ''
    position.value = null
    gewicht.value = null
    geschaetztesAlter.value = ''
    notiz.value = ''
    // Try auto-fetching GPS position when creating a new entry
    tryAutoGps()
  }
  message.value = ''
  showMapPicker.value = false
}

/** Silently pre-fills the position from GPS for a new entry (no error message on failure). */
function tryAutoGps() {
  if (!navigator.geolocation) return
  gpsLoading.value = true
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      position.value = { lat: pos.coords.latitude, lng: pos.coords.longitude }
      gpsLoading.value = false
    },
    () => {
      gpsLoading.value = false
    },
    { timeout: 5000, enableHighAccuracy: true },
  )
}

/** Explicitly requests the device's GPS position and updates the form/map marker, showing errors. */
function requestGpsLocation() {
  if (!navigator.geolocation) {
    message.value = 'GPS wird von diesem Gerät/Browser nicht unterstützt.'
    return
  }
  gpsLoading.value = true
  message.value = ''
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      position.value = { lat: pos.coords.latitude, lng: pos.coords.longitude }
      gpsLoading.value = false
      if (showMapPicker.value && mapInstance && markerInstance) {
        markerInstance.setLatLng([pos.coords.latitude, pos.coords.longitude])
        mapInstance.panTo([pos.coords.latitude, pos.coords.longitude])
      }
    },
    (err) => {
      gpsLoading.value = false
      message.value = `GPS-Signal konnte nicht empfangen werden: ${err.message}`
    },
    { timeout: 10000, enableHighAccuracy: true },
  )
}

/** Shows or hides the map position picker, initializing/tearing down the Leaflet map as needed. */
function toggleMapPicker() {
  showMapPicker.value = !showMapPicker.value
  if (showMapPicker.value) {
    nextTick(initMapPicker)
  } else {
    destroyMapPicker()
  }
}

/** Creates the Leaflet map picker: base layers, Revier boundary, and a draggable/clickable position marker. */
function initMapPicker() {
  if (!mapContainer.value) return
  if (mapInstance) destroyMapPicker()

  const center: Point = position.value ?? props.revierCenter ?? { lat: 51.1657, lng: 10.4515 }
  mapInstance = L.map(mapContainer.value, { zoomControl: true }).setView([center.lat, center.lng], 14)

  const streets = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 19,
  })
  const satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Tiles &copy; Esri',
    maxZoom: 19,
  })

  const savedLayer = localStorage.getItem(mapLayerStorageKey)
  const activeLayer = savedLayer === 'satellite' ? satellite : streets
  activeLayer.addTo(mapInstance)

  L.control.layers({ Straßenkarte: streets, Satellit: satellite }).addTo(mapInstance)

  mapInstance.on('baselayerchange', (event: L.LayersControlEvent) => {
    localStorage.setItem(mapLayerStorageKey, event.name === 'Satellit' ? 'satellite' : 'streets')
  })

  if (props.revierBoundary && props.revierBoundary.features?.length) {
    boundaryLayerInstance = L.geoJSON(props.revierBoundary as any, {
      style: { color: '#2f6b32', weight: 2.5, fillColor: '#2dd36f', fillOpacity: 0.15 },
    }).addTo(mapInstance)

    if (!position.value && boundaryLayerInstance.getBounds().isValid()) {
      mapInstance.fitBounds(boundaryLayerInstance.getBounds(), { padding: [12, 12] })
    }
  }

  if (position.value) {
    markerInstance = createKillMarker([position.value.lat, position.value.lng]).addTo(mapInstance)
    markerInstance.on('dragend', (e) => {
      const latLng = (e.target as L.Marker).getLatLng()
      updatePositionFromMapClick(latLng)
    })
  }

  mapInstance.on('click', (e: L.LeafletMouseEvent) => {
    updatePositionFromMapClick(e.latlng)
  })
}

/** Updates the selected position from a map click/drag, warning if it falls outside the Revier boundary. */
function updatePositionFromMapClick(latLng: L.LatLng) {
  if (props.revierBoundary && !pointInBoundary(props.revierBoundary, latLng.lat, latLng.lng)) {
    message.value = 'Hinweis: Der gewählte Ort liegt außerhalb der Grenze des Reviers.'
  } else {
    message.value = ''
  }

  position.value = { lat: latLng.lat, lng: latLng.lng }
  if (markerInstance) {
    markerInstance.setLatLng(latLng)
  } else if (mapInstance) {
    markerInstance = createKillMarker(latLng).addTo(mapInstance)
    markerInstance.on('dragend', (dragEvt) => {
      const newLatLng = (dragEvt.target as L.Marker).getLatLng()
      updatePositionFromMapClick(newLatLng)
    })
  }
}

/** Tears down the map picker so re-opening it starts from a clean state. */
function destroyMapPicker() {
  if (mapInstance) {
    mapInstance.remove()
    mapInstance = null
    markerInstance = null
    boundaryLayerInstance = null
  }
}

function clearPosition() {
  position.value = null
  if (markerInstance && mapInstance) {
    markerInstance.remove()
    markerInstance = null
  }
}

function close() {
  destroyMapPicker()
  emit('close')
}

/** Creates a new kill entry or saves changes to the one being edited. Queues the request if there's no connectivity. */
async function saveEntry() {
  if (datum.value.length !== 10 || wildart.value.trim().length < 2 || !verwertung.value) return
  saving.value = true
  message.value = ''
  try {
    const isEditing = Boolean(props.entry)
    const endpoint = isEditing
      ? `${apiUrl}/reviere/${props.revierId}/streckeneintraege/${props.entry!.id}`
      : `${apiUrl}/reviere/${props.revierId}/streckeneintraege`

    const parsedGewicht = gewicht.value !== null && gewicht.value !== undefined && !isNaN(Number(gewicht.value)) && String(gewicht.value).trim() !== ''
      ? Number(gewicht.value)
      : undefined

    const formattedTime = uhrzeit.value.trim() ? uhrzeit.value.trim() : undefined
    const isVo = istVerkehrsopfer.value
    const hasBescheinigung = isVo ? !keineBescheinigung.value : false

    const payload = {
      datum: datum.value,
      uhrzeit: formattedTime,
      wildart: wildart.value.trim(),
      unterart: unterart.value.trim() || undefined,
      geschlecht: geschlecht.value || undefined,
      verwertung: verwertung.value,
      kostenfreiArt: kostenfreiArt.value || undefined,
      istVerkehrsopfer: isVo,
      bescheinigung: hasBescheinigung,
      ortName: ortName.value.trim() || undefined,
      position: position.value ?? undefined,
      gewicht: parsedGewicht,
      geschaetztesAlter: geschaetztesAlter.value.trim() || undefined,
      notiz: notiz.value.trim() || undefined,
    }

    const result = await submitOrQueue({
      url: endpoint,
      method: isEditing ? 'PUT' : 'POST',
      body: JSON.stringify(payload),
      description: `Streckeneintrag ${payload.wildart} vom ${payload.datum}`,
    })
    if (result.queued) {
      message.value = 'Keine Verbindung: Der Eintrag wird automatisch gespeichert, sobald wieder online.'
      close()
      return
    }

    let data: { streckeneintrag?: Streckeneintrag; message?: string } = {}
    try {
      data = (await result.response.json()) as { streckeneintrag?: Streckeneintrag; message?: string }
    } catch {
      throw new Error(`Server-Fehler (${result.response.status} ${result.response.statusText}). Bitte prüfen, ob die API neu gestartet/kompiliert wurde.`)
    }

    if (!result.response.ok || !data.streckeneintrag) throw new Error(data.message ?? `Streckeneintrag konnte nicht gespeichert werden (Status ${result.response.status}).`)

    emit('saved', data.streckeneintrag)
    close()
  } catch (error) {
    message.value = error instanceof Error ? error.message : 'Streckeneintrag konnte nicht gespeichert werden.'
  } finally {
    saving.value = false
  }
}

watch(() => props.isOpen, (isOpen) => {
  if (isOpen) reset()
  else destroyMapPicker()
})
</script>

<template>
  <IonModal class="strecke-modal" :is-open="props.isOpen" :backdrop-dismiss="false" @did-dismiss="close">
    <IonContent class="dialog-scroll">
      <div class="dialog-content">
        <div class="dialog-heading">
          <h2>{{ props.entry ? 'Streckeneintrag bearbeiten' : 'Neuer Streckeneintrag' }}</h2>
          <IonButton fill="clear" size="small" class="close-btn" @click="close">✕</IonButton>
        </div>

        <section class="form-section">
          <h3>Datum & Uhrzeit</h3>
          <div class="form-row">
            <label class="field-label flex-1">
              <span>Datum</span>
              <input v-model="datum" class="form-control" type="date" required>
            </label>
            <label class="field-label flex-1">
              <span>Uhrzeit</span>
              <input v-model="uhrzeit" class="form-control" type="time">
            </label>
          </div>
        </section>

        <section class="form-section">
          <h3>Wildart & Kategorie</h3>
          <label class="field-label">
            <span>Wildart</span>
            <input v-model="wildart" class="form-control" type="text" list="wildarten-list" placeholder="z. B. Reh, Fuchs, Wildschwein">
            <datalist id="wildarten-list">
              <option v-for="w in commonWildarten" :key="w" :value="w" />
            </datalist>
          </label>

          <div class="quick-tags">
            <button v-for="w in commonWildarten" :key="w" type="button" class="tag-chip" :class="{ active: wildart === w }" @click="selectWildart(w)">
              {{ w }}
            </button>
          </div>

          <!-- Spezifische Unterarten für Rehwild -->
          <div v-if="isRehwild" class="subspecies-group">
            <span class="subspecies-title">Rehwild-Kategorie auswählen:</span>
            <div class="quick-tags">
              <button
                type="button"
                class="sub-tag-chip"
                :class="{ active: unterart === 'Bock' && geschlecht === 'maennlich' }"
                @click="selectRehCategory({ unterart: 'Bock', geschlecht: 'maennlich' })"
              >
                🦌 Bock (♂)
              </button>
              <button
                type="button"
                class="sub-tag-chip"
                :class="{ active: unterart === 'Ricke' && geschlecht === 'weiblich' }"
                @click="selectRehCategory({ unterart: 'Ricke', geschlecht: 'weiblich' })"
              >
                🦌 Ricke (♀)
              </button>
              <button
                type="button"
                class="sub-tag-chip"
                :class="{ active: unterart === 'Schmalreh' && geschlecht === 'weiblich' }"
                @click="selectRehCategory({ unterart: 'Schmalreh', geschlecht: 'weiblich' })"
              >
                🦌 Schmalreh (♀)
              </button>
              <button
                type="button"
                class="sub-tag-chip"
                :class="{ active: unterart === 'Bockkitz' && geschlecht === 'maennlich' }"
                @click="selectRehCategory({ unterart: 'Bockkitz', geschlecht: 'maennlich' })"
              >
                🦌 Bockkitz (♂)
              </button>
              <button
                type="button"
                class="sub-tag-chip"
                :class="{ active: unterart === 'Kitz' && geschlecht === 'weiblich' }"
                @click="selectRehCategory({ unterart: 'Kitz', geschlecht: 'weiblich' })"
              >
                🦌 Kitz / Rickenkitz (♀)
              </button>
            </div>
          </div>

          <!-- Spezifische Unterarten für Schwarzwild -->
          <div v-else-if="isSchwarzwild" class="subspecies-group">
            <span class="subspecies-title">Schwarzwild-Kategorie auswählen:</span>
            <div class="quick-tags">
              <button type="button" class="sub-tag-chip" :class="{ active: unterart === 'Keiler' }" @click="selectRehCategory({ unterart: 'Keiler', geschlecht: 'maennlich' })">🐗 Keiler (♂)</button>
              <button type="button" class="sub-tag-chip" :class="{ active: unterart === 'Bache' }" @click="selectRehCategory({ unterart: 'Bache', geschlecht: 'weiblich' })">🐗 Bache (♀)</button>
              <button type="button" class="sub-tag-chip" :class="{ active: unterart === 'Überläufer' }" @click="unterart = 'Überläufer'">🐗 Überläufer</button>
              <button type="button" class="sub-tag-chip" :class="{ active: unterart === 'Frischling' }" @click="unterart = 'Frischling'">🐗 Frischling</button>
            </div>
          </div>

          <!-- Spezifische Unterarten für Rotwild/Damwild -->
          <div v-else-if="isRotwildOrDamwild" class="subspecies-group">
            <span class="subspecies-title">Kategorie auswählen:</span>
            <div class="quick-tags">
              <button type="button" class="sub-tag-chip" :class="{ active: unterart === 'Hirsch' }" @click="selectRehCategory({ unterart: 'Hirsch', geschlecht: 'maennlich' })">Hirsch (♂)</button>
              <button type="button" class="sub-tag-chip" :class="{ active: unterart === 'Alttier' }" @click="selectRehCategory({ unterart: 'Alttier', geschlecht: 'weiblich' })">Alttier (♀)</button>
              <button type="button" class="sub-tag-chip" :class="{ active: unterart === 'Schmaltier' }" @click="selectRehCategory({ unterart: 'Schmaltier', geschlecht: 'weiblich' })">Schmaltier (♀)</button>
              <button type="button" class="sub-tag-chip" :class="{ active: unterart === 'Kalb' }" @click="unterart = 'Kalb'">Kalb</button>
            </div>
          </div>

          <!-- Spezifische Unterarten für Fuchs -->
          <div v-else-if="isFuchs" class="subspecies-group">
            <span class="subspecies-title">Kategorie auswählen:</span>
            <div class="quick-tags">
              <button type="button" class="sub-tag-chip" :class="{ active: unterart === 'Rüde' }" @click="selectRehCategory({ unterart: 'Rüde', geschlecht: 'maennlich' })">🦊 Rüde (♂)</button>
              <button type="button" class="sub-tag-chip" :class="{ active: unterart === 'Fähe' }" @click="selectRehCategory({ unterart: 'Fähe', geschlecht: 'weiblich' })">🦊 Fähe (♀)</button>
              <button type="button" class="sub-tag-chip" :class="{ active: unterart === 'Jungfuchs' }" @click="unterart = 'Jungfuchs'">🦊 Jungfuchs</button>
            </div>
          </div>

          <!-- Geschlecht & Unterart Eingabefelder -->
          <div class="form-row">
            <label class="field-label flex-1">
              <span>Geschlecht</span>
              <div class="gender-toggle-group">
                <button
                  type="button"
                  class="gender-btn"
                  :class="{ active: geschlecht === 'maennlich' }"
                  @click="geschlecht = geschlecht === 'maennlich' ? '' : 'maennlich'"
                >
                  ♂ Männlich
                </button>
                <button
                  type="button"
                  class="gender-btn"
                  :class="{ active: geschlecht === 'weiblich' }"
                  @click="geschlecht = geschlecht === 'weiblich' ? '' : 'weiblich'"
                >
                  ♀ Weiblich
                </button>
                <button
                  type="button"
                  class="gender-btn"
                  :class="{ active: geschlecht === 'unbekannt' }"
                  @click="geschlecht = geschlecht === 'unbekannt' ? '' : 'unbekannt'"
                >
                  ? Unbestimmt
                </button>
              </div>
            </label>

            <label class="field-label flex-1">
              <span>Unterart / Kategorie (optional)</span>
              <input v-model="unterart" class="form-control" type="text" placeholder="z. B. Bock, Ricke, Schmalreh">
            </label>
          </div>

          <div class="checkbox-group">
            <label class="checkbox-label">
              <input v-model="istVerkehrsopfer" type="checkbox">
              <span>Verkehrsopfer (VO)</span>
            </label>
            <div v-if="istVerkehrsopfer" class="checkbox-sub-group">
              <label class="checkbox-label sub-label">
                <input v-model="keineBescheinigung" type="checkbox">
                <span>Keine Bescheinigung für Versicherung ausgestellt</span>
              </label>
              <span class="checkbox-hint">(Standardmäßig wird eine Bescheinigung ausgestellt)</span>
            </div>
          </div>
        </section>

        <section class="form-section">
          <h3>Verwertung & Abrechnung</h3>
          <div class="form-row">
            <label class="field-label flex-1">
              <span>Verwertung *</span>
              <select v-model="verwertung" class="form-control" required>
                <option value="" disabled>Bitte auswählen</option>
                <option value="eigenverwertung">Eigenverwertung</option>
                <option value="verkauf_gemeinde">Verkauf innerhalb Gemeinde</option>
                <option value="verkauf_ausserhalb_gemeinde">Verkauf außerhalb Gemeinde</option>
                <option value="jagdgemeinschaft_verkauf">Jagdgemeinschaft übernimmt Verkauf</option>
                <option value="keine_verwertung">Keine Verwertung</option>
              </select>
            </label>
            <label class="field-label flex-1">
              <span>Kostenfrei-Art</span>
              <select v-model="kostenfreiArt" class="form-control">
                <option value="">Keine</option>
                <option value="verkehrsopfer">Verkehrsopfer (VO)</option>
                <option value="hegeabschuss">Hegeabschuss</option>
              </select>
            </label>
          </div>
          <p class="help-text">VO-Wild und Hegeabschüsse werden nicht als kostenpflichtige Verwertung behandelt.</p>
        </section>

        <section class="form-section">
          <h3>Ort & GPS</h3>
          <label class="field-label">
            <span>Ortsbezeichnung / Revierbereich</span>
            <input v-model="ortName" class="form-control" type="text" placeholder="z. B. B27 Km 14, Waldrand Nord">
          </label>

          <div class="location-controls">
            <IonButton fill="outline" size="small" :disabled="gpsLoading" @click="requestGpsLocation">
              {{ gpsLoading ? 'Ermittle GPS...' : '📍 GPS Position verwenden' }}
            </IonButton>
            <IonButton fill="outline" size="small" @click="toggleMapPicker">
              {{ showMapPicker ? 'Karte ausblenden' : '🗺️ Auf Karte wählen' }}
            </IonButton>
          </div>

          <div v-if="position" class="position-info">
            <span>Position: {{ position.lat.toFixed(5) }}, {{ position.lng.toFixed(5) }}</span>
            <button type="button" class="text-btn danger" @click="clearPosition">Entfernen</button>
          </div>

          <div v-show="showMapPicker" class="map-picker-wrapper">
            <p class="help-text">Klicke auf die Karte, um den Ort festzulegen:</p>
            <div ref="mapContainer" class="map-container"></div>
          </div>
        </section>

        <section class="form-section">
          <h3>Gewicht & Alter</h3>
          <div class="form-row">
            <label class="field-label flex-1">
              <span>Gewicht (in kg)</span>
              <input v-model.number="gewicht" class="form-control" type="number" step="0.1" min="0" max="1000" placeholder="z. B. 18.5">
            </label>
            <label class="field-label flex-1">
              <span>Geschätztes Alter</span>
              <input v-model="geschaetztesAlter" class="form-control" type="text" placeholder="z. B. 2 Jahre, Kitz, Schmalreh">
            </label>
          </div>
        </section>

        <section class="form-section">
          <h3>Notizen</h3>
          <label class="field-label">
            <span>Notiz (optional)</span>
            <textarea v-model="notiz" class="form-control textarea-control" rows="2" placeholder="Weitere Angaben zum Abschuss oder Fundort"></textarea>
          </label>
        </section>

        <ImageGallery
          v-if="props.entry"
          :base-url="`${apiUrl}/reviere/${props.revierId}/streckeneintraege/${props.entry.id}/bilder`"
          :can-manage="true"
        />
        <IonNote v-else>Bilder können nach dem Speichern hinzugefügt werden.</IonNote>

        <p v-if="message" class="message">{{ message }}</p>

        <div class="dialog-actions">
          <IonButton fill="clear" :disabled="saving" @click="close">Abbrechen</IonButton>
          <IonButton :disabled="saving || datum.length !== 10 || wildart.trim().length < 2 || !verwertung" @click="saveEntry">
            {{ saving ? 'Speichern...' : 'Speichern' }}
          </IonButton>
        </div>
      </div>
    </IonContent>
  </IonModal>
</template>

<style scoped>
.strecke-modal {
  --width: 90vw;
  --max-width: 680px;
  --height: 90vh;
  --max-height: 800px;
  --border-radius: 12px;
}

.dialog-scroll {
  --background: var(--ion-background-color, #ffffff);
}

.dialog-content {
  padding: 20px;
}

.dialog-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid var(--ion-color-light-shade, #e0e0e0);
  padding-bottom: 12px;
  margin-bottom: 16px;
}

.dialog-heading h2 {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 600;
}

.close-btn {
  --padding-start: 8px;
  --padding-end: 8px;
  font-size: 1.1rem;
}

.form-section {
  margin-bottom: 20px;
  padding-bottom: 16px;
  border-bottom: 1px dashed var(--ion-color-light-shade, #eee);
}

.form-section h3 {
  margin: 0 0 12px;
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--ion-color-medium, #666);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.form-row {
  display: flex;
  gap: 12px;
}

.flex-1 {
  flex: 1;
  min-width: 0;
}

.field-label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
  font-size: 0.9rem;
  font-weight: 500;
}

.form-control {
  padding: 8px 12px;
  border: 1px solid var(--ion-color-medium-tint, #ccc);
  border-radius: 6px;
  font-size: 0.95rem;
  background: var(--ion-background-color, #fff);
  color: var(--ion-text-color, #222);
}

.form-control:focus {
  outline: none;
  border-color: var(--ion-color-primary, #3880ff);
  box-shadow: 0 0 0 2px rgba(56, 128, 255, 0.2);
}

.textarea-control {
  resize: vertical;
  min-height: 60px;
}

.quick-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: -4px 0 12px;
}

.tag-chip {
  background: var(--ion-color-light, #f4f5f8);
  border: 1px solid var(--ion-color-light-shade, #e0e0e0);
  border-radius: 16px;
  padding: 4px 10px;
  font-size: 0.8rem;
  cursor: pointer;
  transition: all 0.15s ease;
}

.tag-chip:hover {
  background: var(--ion-color-light-shade, #e0e0e0);
}

.tag-chip.active {
  background: var(--ion-color-primary, #3880ff);
  color: #fff;
  border-color: var(--ion-color-primary, #3880ff);
}

.subspecies-group {
  margin: 4px 0 12px;
  padding: 10px 12px;
  background: var(--ion-color-light, #f8f9fa);
  border-radius: 8px;
  border: 1px solid var(--ion-color-light-shade, #e9ecef);
}

.subspecies-title {
  display: block;
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--ion-color-medium, #555);
  margin-bottom: 6px;
}

.sub-tag-chip {
  background: #ffffff;
  border: 1px solid #ced4da;
  border-radius: 16px;
  padding: 4px 10px;
  font-size: 0.82rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
}

.sub-tag-chip:hover {
  border-color: var(--ion-color-primary, #3880ff);
  background: #f0f7ff;
}

.sub-tag-chip.active {
  background: #2b7a4b;
  color: #ffffff;
  border-color: #2b7a4b;
  font-weight: 600;
}

.gender-toggle-group {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.gender-btn {
  flex: 1;
  padding: 7px 10px;
  font-size: 0.85rem;
  background: var(--ion-color-light, #f4f5f8);
  border: 1px solid var(--ion-color-light-shade, #ccc);
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;
}

.gender-btn:hover {
  background: var(--ion-color-light-shade, #e0e0e0);
}

.gender-btn.active {
  background: var(--ion-color-primary, #3880ff);
  color: #fff;
  border-color: var(--ion-color-primary, #3880ff);
  font-weight: 600;
}

.checkbox-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 8px;
}

.checkbox-sub-group {
  margin-left: 26px;
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 6px 10px;
  background: var(--ion-color-light, #f8f9fa);
  border-left: 3px solid var(--ion-color-medium-tint, #bbb);
  border-radius: 4px;
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.9rem;
  cursor: pointer;
}

.sub-label {
  font-size: 0.85rem;
  font-weight: 500;
}

.checkbox-hint {
  font-size: 0.75rem;
  color: var(--ion-color-medium, #777);
  margin-left: 26px;
}

.checkbox-label input[type="checkbox"] {
  width: 18px;
  height: 18px;
  accent-color: var(--ion-color-primary, #3880ff);
}

.location-controls {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}

.position-info {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--ion-color-light, #f4f5f8);
  padding: 6px 12px;
  border-radius: 6px;
  font-size: 0.85rem;
  margin-bottom: 8px;
}

.text-btn {
  background: none;
  border: none;
  padding: 0;
  font-size: 0.8rem;
  cursor: pointer;
  text-decoration: underline;
}

.text-btn.danger {
  color: var(--ion-color-danger, #eb445a);
}

.map-picker-wrapper {
  margin-top: 8px;
}

.help-text {
  font-size: 0.8rem;
  color: var(--ion-color-medium, #666);
  margin: 0 0 4px;
}

.map-container {
  height: 280px;
  width: 100%;
  border-radius: 8px;
  border: 1px solid var(--ion-color-light-shade, #ccc);
  overflow: hidden;
}

.message {
  color: var(--ion-color-danger, #eb445a);
  font-size: 0.85rem;
  margin: 8px 0;
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}

:deep(.kill-pin-wrapper) {
  display: flex;
  align-items: center;
  justify-content: center;
  filter: drop-shadow(0 3px 5px rgba(0,0,0,0.4));
}

:deep(.kill-pin-svg) {
  width: 32px;
  height: 32px;
  display: block;
}

@media (max-width: 600px) {
  .form-row {
    flex-direction: column;
    gap: 0;
  }
}
</style>
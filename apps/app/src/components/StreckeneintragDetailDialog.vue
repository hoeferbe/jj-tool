<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { IonButton, IonContent, IonIcon, IonModal } from '@ionic/vue'
import {
  calendarOutline,
  closeOutline,
  createOutline,
  documentTextOutline,
  locationOutline,
  scaleOutline,
  timeOutline,
  trashOutline,
} from 'ionicons/icons'
import * as L from 'leaflet'
import { type Streckeneintrag } from './StreckeneintragDialog.vue'

interface GeoJsonFeatureCollection {
  type: 'FeatureCollection'
  features: Array<{
    type: 'Feature'
    properties?: Record<string, unknown>
    geometry: { type: string; coordinates: unknown }
  }>
}

const props = withDefaults(defineProps<{
  isOpen: boolean
  entry?: Streckeneintrag | null
  revierName?: string
  revierBoundary?: GeoJsonFeatureCollection
}>(), {})

const emit = defineEmits<{
  close: []
  edit: [entry: Streckeneintrag]
  delete: [entry: Streckeneintrag]
}>()

const mapContainer = ref<HTMLElement | null>(null)
let mapInstance: L.Map | null = null
let markerInstance: L.Marker | null = null
let boundaryLayerInstance: L.GeoJSON | null = null
const mapLayerStorageKey = 'jj-revier-map-layer'

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
  return L.marker(latLng, { icon })
}

function formatDateTime(datum?: string, uhrzeit?: string) {
  if (!datum) return ''
  const dateFormatted = new Intl.DateTimeFormat('de-DE', { dateStyle: 'full' }).format(new Date(`${datum}T12:00:00`))
  if (uhrzeit) {
    return `${dateFormatted}, ${uhrzeit} Uhr`
  }
  return dateFormatted
}

function formatGewicht(gewicht?: number) {
  if (gewicht === undefined || gewicht === null) return ''
  return new Intl.NumberFormat('de-DE', { minimumFractionDigits: 0, maximumFractionDigits: 1 }).format(gewicht) + ' kg'
}

function initDetailMap() {
  if (!mapContainer.value || !props.entry?.position) return
  destroyDetailMap()

  const pos = props.entry.position
  mapInstance = L.map(mapContainer.value, { zoomControl: true }).setView([pos.lat, pos.lng], 15)

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
      style: { color: '#2f6b32', weight: 2.5, fillColor: '#2dd36f', fillOpacity: 0.12 },
    }).addTo(mapInstance)
  }

  markerInstance = createKillMarker([pos.lat, pos.lng]).addTo(mapInstance)
  markerInstance.bindPopup(`<b>${props.entry.wildart}</b>${props.entry.unterart ? ` (${props.entry.unterart})` : ''}<br>${props.entry.ortName ?? ''}`).openPopup()
}

function destroyDetailMap() {
  if (mapInstance) {
    mapInstance.remove()
    mapInstance = null
    markerInstance = null
    boundaryLayerInstance = null
  }
}

function close() {
  destroyDetailMap()
  emit('close')
}

function handleEdit() {
  if (props.entry) {
    const entryToEdit = props.entry
    close()
    emit('edit', entryToEdit)
  }
}

function handleDelete() {
  if (props.entry) {
    emit('delete', props.entry)
  }
}

watch(() => props.isOpen, (isOpen) => {
  if (isOpen) {
    nextTick(() => {
      setTimeout(initDetailMap, 150)
    })
  } else {
    destroyDetailMap()
  }
})
</script>

<template>
  <IonModal class="detail-modal" :is-open="props.isOpen" :backdrop-dismiss="true" @did-dismiss="close">
    <IonContent class="dialog-scroll">
      <div v-if="props.entry" class="detail-container">
        <!-- Header -->
        <div class="detail-header">
          <div class="title-wrap">
            <h1 class="main-title">
              {{ props.entry.wildart }}
              <span v-if="props.entry.unterart" class="sub-title">· {{ props.entry.unterart }}</span>
            </h1>
            <p v-if="props.revierName" class="revier-name">{{ props.revierName }}</p>
          </div>
          <button type="button" class="close-btn" @click="close">
            <IonIcon :icon="closeOutline" />
          </button>
        </div>

        <!-- Badges -->
        <div class="badges-bar">
          <span v-if="props.entry.geschlecht === 'maennlich'" class="badge badge-male">♂ Männlich</span>
          <span v-else-if="props.entry.geschlecht === 'weiblich'" class="badge badge-female">♀ Weiblich</span>
          <span v-else-if="props.entry.geschlecht === 'unbekannt'" class="badge badge-neutral">? Unbestimmt</span>

          <template v-if="props.entry.istVerkehrsopfer">
            <span class="badge badge-warning">🚗 Verkehrsopfer (VO)</span>
            <span v-if="props.entry.bescheinigung !== false" class="badge badge-info">📜 Versicherungsbescheinigung</span>
            <span v-else class="badge badge-neutral">Keine Versicherungsbescheinigung</span>
          </template>
        </div>

        <!-- Info Cards Grid -->
        <div class="info-grid">
          <div class="info-card">
            <div class="info-icon"><IonIcon :icon="calendarOutline" /></div>
            <div class="info-text">
              <span class="info-label">Datum & Zeit</span>
              <span class="info-value">{{ formatDateTime(props.entry.datum, props.entry.uhrzeit) }}</span>
            </div>
          </div>

          <div v-if="props.entry.gewicht" class="info-card">
            <div class="info-icon"><IonIcon :icon="scaleOutline" /></div>
            <div class="info-text">
              <span class="info-label">Gewicht</span>
              <span class="info-value">{{ formatGewicht(props.entry.gewicht) }}</span>
            </div>
          </div>

          <div v-if="props.entry.geschaetztesAlter" class="info-card">
            <div class="info-icon"><IonIcon :icon="timeOutline" /></div>
            <div class="info-text">
              <span class="info-label">Geschätztes Alter</span>
              <span class="info-value">{{ props.entry.geschaetztesAlter }}</span>
            </div>
          </div>

          <div v-if="props.entry.ortName" class="info-card">
            <div class="info-icon"><IonIcon :icon="locationOutline" /></div>
            <div class="info-text">
              <span class="info-label">Ort / Revierbereich</span>
              <span class="info-value">{{ props.entry.ortName }}</span>
            </div>
          </div>
        </div>

        <!-- Map Section -->
        <div v-if="props.entry.position" class="map-section">
          <div class="map-header">
            <h3>📍 Kartenausschnitt & Abschussort</h3>
            <span class="coords-tag">{{ props.entry.position.lat.toFixed(5) }}, {{ props.entry.position.lng.toFixed(5) }}</span>
          </div>
          <div ref="mapContainer" class="detail-map"></div>
          <p class="map-hint">Umschaltbar zwischen Straßenkarte und Satellitenbild über die Kartenebene oben rechts.</p>
        </div>

        <!-- Notiz -->
        <div v-if="props.entry.notiz" class="notes-section">
          <h3><IonIcon :icon="documentTextOutline" /> Notizen & Anmerkungen</h3>
          <p class="notes-body">{{ props.entry.notiz }}</p>
        </div>

        <!-- Actions -->
        <div class="dialog-actions">
          <IonButton color="danger" fill="outline" size="small" @click="handleDelete">
            <IonIcon slot="start" :icon="trashOutline" /> Löschen
          </IonButton>
          <div class="action-right">
            <IonButton fill="clear" @click="close">Schließen</IonButton>
            <IonButton @click="handleEdit">
              <IonIcon slot="start" :icon="createOutline" /> Bearbeiten
            </IonButton>
          </div>
        </div>
      </div>
    </IonContent>
  </IonModal>
</template>

<style scoped>
.detail-modal {
  --width: 92vw;
  --max-width: 720px;
  --height: 90vh;
  --max-height: 850px;
  --border-radius: 12px;
}

.dialog-scroll {
  --background: var(--ion-background-color, #ffffff);
}

.detail-container {
  padding: 24px;
}

.detail-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  border-bottom: 1px solid var(--ion-color-light-shade, #e0e0e0);
  padding-bottom: 16px;
  margin-bottom: 16px;
}

.main-title {
  margin: 0 0 4px;
  font-size: 1.6rem;
  font-weight: 700;
  color: var(--ion-text-color, #1a1a1a);
}

.sub-title {
  font-weight: 600;
  color: var(--ion-color-primary, #3880ff);
}

.revier-name {
  margin: 0;
  font-size: 0.95rem;
  color: var(--ion-color-medium, #666);
}

.close-btn {
  background: none;
  border: none;
  font-size: 1.6rem;
  color: var(--ion-color-medium, #777);
  cursor: pointer;
  padding: 4px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.close-btn:hover {
  background: var(--ion-color-light, #f4f5f8);
  color: var(--ion-color-dark, #000);
}

.badges-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 20px;
}

.badge {
  font-size: 0.85rem;
  font-weight: 600;
  padding: 4px 12px;
  border-radius: 16px;
}

.badge-male {
  background: #e3f2fd;
  color: #1565c0;
  border: 1px solid #bbdefb;
}

.badge-female {
  background: #fce4ec;
  color: #c2185b;
  border: 1px solid #f8bbd0;
}

.badge-neutral {
  background: #f5f5f5;
  color: #616161;
  border: 1px solid #e0e0e0;
}

.badge-warning {
  background: #fff3cd;
  color: #856404;
  border: 1px solid #ffeeba;
}

.badge-info {
  background: #d1ecf1;
  color: #0c5460;
  border: 1px solid #bee5eb;
}

.info-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 12px;
  margin-bottom: 20px;
}

.info-card {
  display: flex;
  align-items: center;
  gap: 12px;
  background: var(--ion-color-light, #f8f9fa);
  border: 1px solid var(--ion-color-light-shade, #e9ecef);
  padding: 12px 14px;
  border-radius: 8px;
}

.info-icon {
  font-size: 1.4rem;
  color: var(--ion-color-primary, #3880ff);
  display: flex;
  align-items: center;
}

.info-text {
  display: flex;
  flex-direction: column;
}

.info-label {
  font-size: 0.75rem;
  color: var(--ion-color-medium, #666);
  text-transform: uppercase;
  font-weight: 600;
  letter-spacing: 0.5px;
}

.info-value {
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--ion-text-color, #222);
}

.map-section {
  margin-bottom: 20px;
}

.map-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.map-header h3 {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
  color: var(--ion-color-dark, #222);
}

.coords-tag {
  font-size: 0.8rem;
  font-family: monospace;
  background: var(--ion-color-light, #f4f5f8);
  padding: 2px 8px;
  border-radius: 4px;
  border: 1px solid var(--ion-color-light-shade, #e0e0e0);
}

.detail-map {
  height: 320px;
  width: 100%;
  border-radius: 10px;
  border: 1px solid var(--ion-color-light-shade, #ccc);
  overflow: hidden;
}

.map-hint {
  font-size: 0.8rem;
  color: var(--ion-color-medium, #777);
  margin: 6px 0 0;
  font-style: italic;
}

.notes-section {
  margin-bottom: 20px;
  padding: 14px 16px;
  background: var(--ion-color-light, #f8f9fa);
  border-left: 4px solid var(--ion-color-primary, #3880ff);
  border-radius: 6px;
}

.notes-section h3 {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0 0 8px;
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--ion-color-dark, #222);
}

.notes-body {
  margin: 0;
  font-size: 0.92rem;
  color: var(--ion-text-color, #333);
  white-space: pre-wrap;
  line-height: 1.4;
}

.dialog-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 24px;
  padding-top: 16px;
  border-top: 1px solid var(--ion-color-light-shade, #e0e0e0);
}

.action-right {
  display: flex;
  gap: 8px;
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
</style>
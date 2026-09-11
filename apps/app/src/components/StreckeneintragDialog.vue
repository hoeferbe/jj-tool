<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'
import { IonButton, IonContent, IonModal, IonNote } from '@ionic/vue'
import * as L from 'leaflet'

interface Point { lat: number; lng: number }

export interface Streckeneintrag {
  id: string
  revierId: string
  datum: string
  uhrzeit?: string
  wildart: string
  istVerkehrsopfer?: boolean
  bescheinigung?: boolean
  ortName?: string
  position?: Point
  gewicht?: number
  geschaetztesAlter?: string
  notiz?: string
  createdBy: string
  createdAt: string
  updatedAt?: string
}

const props = withDefaults(defineProps<{
  isOpen: boolean
  revierId: string
  entry?: Streckeneintrag | null
  defaultCenter?: Point
}>(), {})

const emit = defineEmits<{
  close: []
  saved: [entry: Streckeneintrag]
}>()

const apiUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:8787'

function getCurrentDateStr() {
  return new Date().toISOString().slice(0, 10)
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
const istVerkehrsopfer = ref(false)
const bescheinigung = ref(false)
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

const commonWildarten = ['Reh', 'Wildschwein', 'Fuchs', 'Fasan', 'Hase', 'Dachs', 'Waschbär', 'Damwild', 'Rotwild']

function reset() {
  if (props.entry) {
    datum.value = props.entry.datum
    uhrzeit.value = props.entry.uhrzeit ?? ''
    wildart.value = props.entry.wildart
    istVerkehrsopfer.value = Boolean(props.entry.istVerkehrsopfer)
    bescheinigung.value = Boolean(props.entry.bescheinigung)
    ortName.value = props.entry.ortName ?? ''
    position.value = props.entry.position ? { ...props.entry.position } : null
    gewicht.value = props.entry.gewicht ?? null
    geschaetztesAlter.value = props.entry.geschaetztesAlter ?? ''
    notiz.value = props.entry.notiz ?? ''
  } else {
    datum.value = getCurrentDateStr()
    uhrzeit.value = getCurrentTimeStr()
    wildart.value = ''
    istVerkehrsopfer.value = false
    bescheinigung.value = false
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

function toggleMapPicker() {
  showMapPicker.value = !showMapPicker.value
  if (showMapPicker.value) {
    nextTick(initMapPicker)
  } else {
    destroyMapPicker()
  }
}

function initMapPicker() {
  if (!mapContainer.value) return
  if (mapInstance) destroyMapPicker()

  const center: Point = position.value ?? props.defaultCenter ?? { lat: 51.1657, lng: 10.4515 }
  mapInstance = L.map(mapContainer.value, { zoomControl: true }).setView([center.lat, center.lng], 14)

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap',
    maxZoom: 19,
  }).addTo(mapInstance)

  if (position.value) {
    markerInstance = L.marker([position.value.lat, position.value.lng], { draggable: true }).addTo(mapInstance)
    markerInstance.on('dragend', (e) => {
      const latLng = (e.target as L.Marker).getLatLng()
      position.value = { lat: latLng.lat, lng: latLng.lng }
    })
  }

  mapInstance.on('click', (e: L.LeafletMouseEvent) => {
    position.value = { lat: e.latlng.lat, lng: e.latlng.lng }
    if (markerInstance) {
      markerInstance.setLatLng(e.latlng)
    } else if (mapInstance) {
      markerInstance = L.marker(e.latlng, { draggable: true }).addTo(mapInstance)
      markerInstance.on('dragend', (dragEvt) => {
        const latLng = (dragEvt.target as L.Marker).getLatLng()
        position.value = { lat: latLng.lat, lng: latLng.lng }
      })
    }
  })
}

function destroyMapPicker() {
  if (mapInstance) {
    mapInstance.remove()
    mapInstance = null
    markerInstance = null
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

async function saveEntry() {
  if (datum.value.length !== 10 || wildart.value.trim().length < 2) return
  saving.value = true
  message.value = ''
  const token = localStorage.getItem('accessToken')
  try {
    const isEditing = Boolean(props.entry)
    const endpoint = isEditing
      ? `${apiUrl}/reviere/${props.revierId}/streckeneintraege/${props.entry!.id}`
      : `${apiUrl}/reviere/${props.revierId}/streckeneintraege`

    const payload = {
      datum: datum.value,
      uhrzeit: uhrzeit.value.trim() || undefined,
      wildart: wildart.value.trim(),
      istVerkehrsopfer: istVerkehrsopfer.value,
      bescheinigung: bescheinigung.value,
      ortName: ortName.value.trim() || undefined,
      position: position.value ?? undefined,
      gewicht: gewicht.value !== null && !isNaN(Number(gewicht.value)) ? Number(gewicht.value) : undefined,
      geschaetztesAlter: geschaetztesAlter.value.trim() || undefined,
      notiz: notiz.value.trim() || undefined,
    }

    const response = await fetch(endpoint, {
      method: isEditing ? 'PUT' : 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const data = await response.json() as { streckeneintrag?: Streckeneintrag; message?: string }
    if (!response.ok || !data.streckeneintrag) throw new Error(data.message ?? 'Streckeneintrag konnte nicht gespeichert werden.')
    
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
          <h3>Wildart & Status</h3>
          <label class="field-label">
            <span>Wildart</span>
            <input v-model="wildart" class="form-control" type="text" list="wildarten-list" placeholder="z. B. Reh, Fuchs, Wildschwein">
            <datalist id="wildarten-list">
              <option v-for="w in commonWildarten" :key="w" :value="w" />
            </datalist>
          </label>

          <div class="quick-tags">
            <button v-for="w in commonWildarten" :key="w" type="button" class="tag-chip" :class="{ active: wildart === w }" @click="wildart = w">
              {{ w }}
            </button>
          </div>

          <div class="checkbox-group">
            <label class="checkbox-label">
              <input v-model="istVerkehrsopfer" type="checkbox">
              <span>Verkehrsopfer (VO)</span>
            </label>
            <label class="checkbox-label">
              <input v-model="bescheinigung" type="checkbox">
              <span>Bescheinigung für Versicherung ausgestellt</span>
            </label>
          </div>
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

        <p v-if="message" class="message">{{ message }}</p>

        <div class="dialog-actions">
          <IonButton fill="clear" :disabled="saving" @click="close">Abbrechen</IonButton>
          <IonButton :disabled="saving || datum.length !== 10 || wildart.trim().length < 2" @click="saveEntry">
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

.checkbox-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 8px;
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.9rem;
  cursor: pointer;
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
  height: 200px;
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

@media (max-width: 600px) {
  .form-row {
    flex-direction: column;
    gap: 0;
  }
}
</style>
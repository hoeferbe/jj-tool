<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as L from 'leaflet'
import BkgAttribution from './BkgAttribution.vue'

interface GeoJsonFeatureCollection {
  type: 'FeatureCollection'
  features: Array<{
    type: 'Feature'
    properties?: Record<string, unknown>
    geometry: { type: string; coordinates: unknown }
  }>
}

interface Jagdeinrichtung {
  id: string
  revierId: string
  name: string
  typ: 'Kanzel' | 'Bock' | 'Leiter' | 'Roehrenfalle' | 'Kirrung'
  position: { lat: number; lng: number }
  status: 'aktiv' | 'defekt' | 'ausser Betrieb'
  notiz?: string
  createdBy: string
  createdAt: string
  updatedAt: string
}

const props = withDefaults(defineProps<{
  boundary: GeoJsonFeatureCollection
  sourceYear: number
  facilities?: Jagdeinrichtung[]
  positioningFacilityId?: string | null
  facilityPlacementMode?: boolean
  canCreateFacilities?: boolean
}>(), { facilities: () => [], canCreateFacilities: true })
const emit = defineEmits<{
  facilitySelected: [facility: Jagdeinrichtung]
  facilityPositionSelected: [selection: { position: { lat: number; lng: number }; facilityId?: string }]
  facilityPlacementRequested: []
  facilityPlacementCancelled: []
  facilityPositionRejected: []
}>()
const container = ref<HTMLElement | null>(null)
const tileError = ref(false)
let map: L.Map | null = null
let placementButton: HTMLButtonElement | null = null
let savedView: { center: L.LatLng; zoom: number } | null = null
let renderedBoundary: GeoJsonFeatureCollection | null = null
const mapLayerStorageKey = 'jj-revier-map-layer'

function updatePlacementButton() {
  placementButton?.classList.toggle('active', props.facilityPlacementMode === true)
}

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

function pointInBoundary(lat: number, lng: number) {
  return props.boundary.features.some((feature) => {
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

function handleEscape(event: KeyboardEvent) {
  if (event.key === 'Escape' && props.facilityPlacementMode) emit('facilityPlacementCancelled')
}

function addFacilityPlacementControl() {
  if (!map) return
  const control = new L.Control({ position: 'topright' })
  control.onAdd = () => {
    placementButton = L.DomUtil.create('button', 'facility-create-control') as HTMLButtonElement
    placementButton.type = 'button'
    placementButton.title = 'Einrichtung anlegen'
    placementButton.setAttribute('aria-label', 'Einrichtung anlegen')
    placementButton.textContent = '+'
    L.DomEvent.disableClickPropagation(placementButton)
    L.DomEvent.on(placementButton, 'click', () => emit('facilityPlacementRequested'))
    updatePlacementButton()
    return placementButton
  }
  control.addTo(map)
}

const facilityLabels: Record<Jagdeinrichtung['typ'], string> = {
  Kanzel: 'K', Bock: 'B', Leiter: 'L', Roehrenfalle: 'F', Kirrung: 'R',
}
const statusLabels: Record<Jagdeinrichtung['status'], string> = {
  aktiv: 'Aktiv', defekt: 'Defekt', 'ausser Betrieb': 'Außer Betrieb',
}
const statusMarkerStyles: Record<Jagdeinrichtung['status'], { background: string; color: string; border: string }> = {
  aktiv: { background: '#52652d', color: '#ffffff', border: '#e8f0dc' },
  defekt: { background: '#ffc409', color: '#20271b', border: '#8a6d00' },
  'ausser Betrieb': { background: '#92949c', color: '#ffffff', border: '#4d5058' },
}

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[character] ?? character)
}

function addFacilitiesToMap() {
  if (!map) return
  const layer = L.layerGroup()
  for (const facility of props.facilities) {
    const markerStyle = statusMarkerStyles[facility.status]
    const isPositioning = props.positioningFacilityId === facility.id
    const marker = L.marker([facility.position.lat, facility.position.lng], {
      icon: L.divIcon({
        className: 'facility-marker',
        html: `<span style="display:flex;width:24px;height:24px;align-items:center;justify-content:center;border:2px solid ${isPositioning ? '#d32f2f' : markerStyle.border};border-radius:4px;background:${markerStyle.background};color:${markerStyle.color};font:700 12px/1 sans-serif;opacity:${isPositioning ? '0.6' : '1'};box-shadow:0 2px 5px rgba(0,0,0,.28)">${facilityLabels[facility.typ]}</span>`,
        iconSize: [24, 24],
        iconAnchor: [12, 12],
      }),
      title: facility.name,
    })
    if (!isPositioning) {
      marker.bindPopup(`<strong>${escapeHtml(facility.name)}</strong><br>${escapeHtml(facility.typ)} · ${statusLabels[facility.status]}`)
    }
    marker.on('click', (event) => {
      L.DomEvent.stopPropagation(event)
      if (props.positioningFacilityId === facility.id) {
        emit('facilityPositionSelected', {
          position: { lat: event.latlng.lat, lng: event.latlng.lng },
          facilityId: facility.id,
        })
      } else {
        emit('facilitySelected', facility)
      }
    })
    marker.addTo(layer)
  }
  layer.addTo(map)
}

function buildMask(boundary: GeoJsonFeatureCollection) {
  const holes: number[][][] = []
  for (const feature of boundary.features) {
    if (feature.geometry.type === 'Polygon') {
      const polygon = feature.geometry.coordinates as number[][][]
      if (polygon[0]) holes.push(polygon[0])
    } else if (feature.geometry.type === 'MultiPolygon') {
      for (const polygon of feature.geometry.coordinates as number[][][][]) {
        if (polygon[0]) holes.push(polygon[0])
      }
    }
  }
  if (!holes.length) return null
  return {
    type: 'FeatureCollection' as const,
    features: [{
      type: 'Feature' as const,
      properties: {},
      geometry: {
        type: 'Polygon' as const,
        coordinates: [[[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]], ...holes],
      },
    }],
  }
}

async function renderMap() {
  if (map && props.boundary === renderedBoundary) savedView = { center: map.getCenter(), zoom: map.getZoom() }
  else savedView = null
  map?.remove()
  map = null
  tileError.value = false
  await nextTick()
  if (!container.value || !props.boundary.features.length) return

  renderedBoundary = props.boundary
  map = L.map(container.value)
  const streets = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
  })
  const satellite = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { attribution: 'Tiles &copy; Esri' },
  )
  streets.on('tileerror', () => { tileError.value = true })
  satellite.on('tileerror', () => { tileError.value = true })
  const savedLayer = localStorage.getItem(mapLayerStorageKey)
  const activeLayer = savedLayer === 'satellite' ? satellite : streets
  activeLayer.addTo(map)
  L.control.layers({ Straßenkarte: streets, Satellit: satellite }).addTo(map)
  map.on('baselayerchange', (event: L.LayersControlEvent) => {
    localStorage.setItem(mapLayerStorageKey, event.name === 'Satellit' ? 'satellite' : 'streets')
  })
  if (props.canCreateFacilities) addFacilityPlacementControl()
  map.on('click', (event: L.LeafletMouseEvent) => {
    if (props.facilityPlacementMode || event.originalEvent.metaKey || event.originalEvent.ctrlKey) {
      if (!pointInBoundary(event.latlng.lat, event.latlng.lng)) {
        emit('facilityPositionRejected')
        return
      }
      emit('facilityPositionSelected', {
        position: { lat: event.latlng.lat, lng: event.latlng.lng },
        facilityId: props.positioningFacilityId ?? undefined,
      })
    }
  })

  const mask = buildMask(props.boundary)
  if (mask) {
    L.geoJSON(mask, {
      style: { color: 'transparent', weight: 0, fillColor: '#101821', fillOpacity: 0.5, fillRule: 'evenodd' },
    }).addTo(map)
  }
  const boundaryLayer = L.geoJSON(props.boundary, {
    style: { color: '#2f6b32', weight: 3, fillColor: '#2dd36f', fillOpacity: 0.08 },
  }).addTo(map)
  addFacilitiesToMap()
  const bounds = boundaryLayer.getBounds()
  requestAnimationFrame(() => {
    map?.invalidateSize()
    if (savedView) map?.setView(savedView.center, savedView.zoom, { animate: false })
    else if (bounds.isValid()) map?.fitBounds(bounds, { padding: [24, 24] })
    savedView = null
  })
}

watch([() => props.boundary, () => props.facilities, () => props.positioningFacilityId, () => props.facilityPlacementMode], renderMap, { deep: true })
watch(() => props.facilityPlacementMode, updatePlacementButton)
onMounted(renderMap)
onMounted(() => window.addEventListener('keydown', handleEscape))
onBeforeUnmount(() => {
  map?.remove()
  window.removeEventListener('keydown', handleEscape)
})
</script>

<template>
  <div class="map-stage" :class="{ 'placement-active': props.facilityPlacementMode }">
    <div v-if="props.facilityPlacementMode" class="placement-banner" role="status">
      Einrichtung: Position wählen
      <span>Tippe innerhalb der Reviergrenze</span>
    </div>
    <div ref="container" class="revier-map"></div>
  </div>
  <BkgAttribution :year="sourceYear" />
  <p v-if="tileError" class="map-error">Die Kartenkacheln konnten nicht geladen werden.</p>
</template>

<style scoped>
.revier-map {
  width: 100%;
  height: 90dvh;
  min-height: 440px;
  border: 1px solid var(--ion-color-light-shade, #dfe6dd);
  border-radius: 8px;
  overflow: hidden;
}

.map-stage {
  position: relative;
}

.map-stage.placement-active {
  border: 4px solid #f2c94c;
  border-radius: 10px;
  box-shadow: 0 0 0 2px rgba(32, 39, 27, 0.35);
}

.placement-banner {
  position: absolute;
  z-index: 1000;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: baseline;
  gap: 10px;
  width: max-content;
  max-width: calc(100% - 24px);
  padding: 8px 14px;
  border: 2px solid #8a6d00;
  border-radius: 6px;
  background: #f2c94c;
  color: #20271b;
  font-weight: 700;
  pointer-events: none;
}

.placement-banner span {
  font-size: 0.85rem;
  font-weight: 400;
}

.map-error {
  color: var(--ion-color-danger);
}

:global(.facility-create-control) {
  width: 36px;
  height: 36px;
  border: 2px solid rgba(0, 0, 0, 0.2);
  border-radius: 4px;
  background: #ffffff;
  color: #52652d;
  font-size: 24px;
  font-weight: 700;
  line-height: 1;
  padding: 0 0 2px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

:global(.facility-create-control.active) {
  background: #52652d;
  color: #ffffff;
}

</style>
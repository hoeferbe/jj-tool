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
  focusFacilityId?: string | null
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
const distancePlacementMode = ref(false)
let map: L.Map | null = null
let placementButton: HTMLButtonElement | null = null
let distanceButton: HTMLButtonElement | null = null
let facilityLayer: L.LayerGroup | null = null
let distanceLayer: L.LayerGroup | null = null
let distanceCenter: L.LatLng | null = null
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
  if (event.key === 'Escape' && distancePlacementMode.value) cancelDistancePlacement()
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

function focusFacility(facilityId?: string | null) {
  if (!map || !facilityId) return
  const facility = props.facilities.find((entry) => entry.id === facilityId)
  if (facility) map.setView([facility.position.lat, facility.position.lng], 17, { animate: true })
}

function toggleDistanceRings() {
  if (!map) return
  if (distanceLayer) {
    map.off('zoomend', renderDistanceRings)
    map.off('resize', renderDistanceRings)
    distanceLayer.remove()
    distanceLayer = null
    distanceCenter = null
    distanceButton?.classList.remove('active')
    return
  }
  if (distancePlacementMode.value) {
    cancelDistancePlacement()
    return
  }
  if (!navigator.geolocation) {
    startDistancePlacementMode()
    return
  }
  distanceButton?.classList.add('locating')
  navigator.geolocation.getCurrentPosition((position) => {
    distanceButton?.classList.remove('locating')
    placeDistanceRings(L.latLng(position.coords.latitude, position.coords.longitude), true)
  }, () => {
    distanceButton?.classList.remove('locating')
    startDistancePlacementMode()
  }, { enableHighAccuracy: true, timeout: 8000 })
}

function startDistancePlacementMode() {
  if (!map) return
  distancePlacementMode.value = true
  distanceButton?.classList.add('placing')
  map.getContainer().style.cursor = 'crosshair'
}

function cancelDistancePlacement() {
  distancePlacementMode.value = false
  distanceButton?.classList.remove('placing')
  if (map) map.getContainer().style.cursor = ''
}

function placeDistanceRings(latlng: L.LatLng, recenter = false) {
  if (!map) return
  distanceCenter = latlng
  cancelDistancePlacement()
  distanceButton?.classList.add('active')
  if (recenter) map.setView(latlng, Math.max(map.getZoom(), 16), { animate: true })
  renderDistanceRings()
  map.on('zoomend', renderDistanceRings)
  map.on('resize', renderDistanceRings)
}

const DISTANCE_RING_STEPS = [50, 100, 150, 200, 300, 400]

function metersPerPixel() {
  if (!map) return 0
  const center = map.getCenter()
  return (156543.03392 * Math.cos((center.lat * Math.PI) / 180)) / Math.pow(2, map.getZoom())
}

function ringDistancesForView() {
  if (!map) return DISTANCE_RING_STEPS.slice(0, 2)
  const size = map.getSize()
  // a ring only needs to fit fully along one dimension; the other side may clip it
  const maxRadiusPx = Math.max(size.x, size.y) / 2 - 40
  const maxRadiusMeters = maxRadiusPx * metersPerPixel()
  const steps = DISTANCE_RING_STEPS.filter((radius) => radius <= maxRadiusMeters)
  return steps.length >= 2 ? steps : DISTANCE_RING_STEPS.slice(0, 2)
}

function renderDistanceRings() {
  if (!map || !distanceCenter) return
  distanceLayer?.remove()
  const layer = L.layerGroup()
  L.circleMarker(distanceCenter, { radius: 6, color: '#ffffff', weight: 2, fillColor: '#1976d2', fillOpacity: 1 })
    .bindTooltip('Aktueller Standort')
    .addTo(layer)
  for (const radius of ringDistancesForView()) {
    L.circle(distanceCenter, { radius, color: '#ffffff', weight: 2, opacity: 0.9, fillColor: '#1976d2', fillOpacity: 0.04 })
      .addTo(layer)
    L.marker([distanceCenter.lat + radius / 111320, distanceCenter.lng], {
      interactive: false,
      icon: L.divIcon({
        className: 'distance-ring-label',
        html: `<span>${radius} m</span>`,
        iconSize: [48, 18],
        iconAnchor: [24, 9],
      }),
    }).addTo(layer)
  }
  layer.addTo(map)
  distanceLayer = layer
}

function addDistanceControl() {
  if (!map) return
  const control = new L.Control({ position: 'topright' })
  control.onAdd = () => {
    distanceButton = L.DomUtil.create('button', 'distance-ring-control') as HTMLButtonElement
    distanceButton.type = 'button'
    distanceButton.title = 'Distanzringe auf Karte platzieren'
    distanceButton.setAttribute('aria-label', 'Distanzringe auf Karte platzieren')
    distanceButton.textContent = '◎'
    L.DomEvent.disableClickPropagation(distanceButton)
    L.DomEvent.on(distanceButton, 'click', toggleDistanceRings)
    return distanceButton
  }
  control.addTo(map)
}

const facilityLabels: Record<Jagdeinrichtung['typ'], string> = {
  Kanzel: 'K', Bock: 'B', Leiter: 'L', Roehrenfalle: 'F', Kirrung: 'R',
}
const statusMarkerStyles: Record<Jagdeinrichtung['status'], { background: string; color: string; border: string }> = {
  aktiv: { background: '#52652d', color: '#ffffff', border: '#e8f0dc' },
  defekt: { background: '#e57373', color: '#3a1414', border: '#ca6565' },
  'ausser Betrieb': { background: '#92949c', color: '#ffffff', border: '#4d5058' },
}

function addFacilitiesToMap() {
  if (!map) return
  facilityLayer?.removeFrom(map)
  const layer = L.layerGroup()
  for (const facility of props.facilities) {
    const markerStyle = statusMarkerStyles[facility.status]
    const isPositioning = props.positioningFacilityId === facility.id
    const marker = L.marker([facility.position.lat, facility.position.lng], {
      icon: L.divIcon({
        className: `facility-marker${isPositioning ? ' facility-marker-positioning' : ''}`,
        html: `<span style="display:flex;width:24px;height:24px;align-items:center;justify-content:center;border:2px solid ${isPositioning ? '#d32f2f' : markerStyle.border};border-radius:4px;background:${isPositioning ? '#ffee58' : markerStyle.background};color:${isPositioning ? '#3a1414' : markerStyle.color};font:700 12px/1 sans-serif;box-shadow:0 2px 5px rgba(0,0,0,.28)">${facilityLabels[facility.typ]}</span>`,
        iconSize: [24, 24],
        iconAnchor: [12, 12],
      }),
      title: facility.name,
    })
    marker.on('click', (event) => {
      const preservedCenter = map?.getCenter()
      const preservedZoom = map?.getZoom()
      L.DomEvent.stop(event)
      if (props.positioningFacilityId === facility.id) {
        emit('facilityPositionSelected', {
          position: { lat: event.latlng.lat, lng: event.latlng.lng },
          facilityId: facility.id,
        })
      } else {
        emit('facilitySelected', facility)
      }
      if (preservedCenter && preservedZoom !== undefined) {
        requestAnimationFrame(() => requestAnimationFrame(() => {
          map?.setView(preservedCenter, preservedZoom, { animate: false })
        }))
      }
    })
    marker.addTo(layer)
  }
  layer.addTo(map)
  facilityLayer = layer
}

function clearFacilityMarkers() {
  facilityLayer?.remove()
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
  if (map && props.boundary === renderedBoundary) return
  savedView = null
  map?.remove()
  facilityLayer = null
  distanceLayer = null
  distanceButton = null
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
  addDistanceControl()
  map.on('click', (event: L.LeafletMouseEvent) => {
    if (distancePlacementMode.value) {
      placeDistanceRings(event.latlng)
      return
    }
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
    else if (props.focusFacilityId) focusFacility(props.focusFacilityId)
    else if (bounds.isValid()) map?.fitBounds(bounds, { padding: [24, 24] })
    savedView = null
  })
}

watch(() => props.facilities, () => {
  if (!map) return
  clearFacilityMarkers()
  addFacilitiesToMap()
}, { deep: true })
watch(() => props.positioningFacilityId, () => {
  if (!map) return
  addFacilitiesToMap()
})
watch(() => props.boundary, renderMap, { deep: true })
watch(() => props.facilityPlacementMode, updatePlacementButton)
watch(() => props.focusFacilityId, focusFacility)
onMounted(renderMap)
onMounted(() => window.addEventListener('keydown', handleEscape))
onBeforeUnmount(() => {
  map?.remove()
  window.removeEventListener('keydown', handleEscape)
})
</script>

<template>
  <div class="map-stage" :class="{ 'placement-active': props.facilityPlacementMode, 'distance-placement-active': distancePlacementMode }">
    <div v-if="props.facilityPlacementMode" class="placement-banner" role="status">
      Einrichtung: Position wählen
      <span>Tippe innerhalb der Reviergrenze</span>
    </div>
    <div v-if="distancePlacementMode" class="placement-banner distance-banner" role="status">
      Distanzringe: Position wählen
      <span>Klicke auf die Karte · Esc zum Abbrechen</span>
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

.map-stage.distance-placement-active {
  border: 4px solid #1976d2;
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

.distance-banner {
  border-color: #184f82;
  background: #1976d2;
  color: #ffffff;
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

:global(.distance-ring-control) {
  width: 36px;
  height: 36px;
  border: 2px solid rgba(0, 0, 0, 0.2);
  border-radius: 4px;
  background: #ffffff;
  color: #1976d2;
  font-size: 24px;
  line-height: 1;
  cursor: pointer;
}

:global(.distance-ring-control.active) { background: #1976d2; color: #ffffff; }
:global(.distance-ring-control.placing) { background: #1976d2; color: #ffffff; animation: facility-marker-glow 1.1s ease-in-out infinite; }
:global(.distance-ring-control.locating) { background: #1976d2; color: #ffffff; opacity: 0.7; }
:global(.distance-ring-label span) { display: block; width: max-content; padding: 1px 4px; border-radius: 3px; background: rgba(255, 255, 255, 0.88); color: #184f82; font: 700 10px/1.4 sans-serif; box-shadow: 0 1px 2px rgba(0, 0, 0, 0.3); }

:global(.facility-marker-positioning span) { animation: facility-marker-glow 1.1s ease-in-out infinite; }
@keyframes facility-marker-glow {
  0% { box-shadow: 0 0 0 0 rgba(211, 47, 47, 0.65); }
  70% { box-shadow: 0 0 0 14px rgba(211, 47, 47, 0); }
  100% { box-shadow: 0 0 0 0 rgba(211, 47, 47, 0); }
}

</style>
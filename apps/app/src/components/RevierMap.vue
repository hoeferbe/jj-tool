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

const props = defineProps<{ boundary: GeoJsonFeatureCollection; sourceYear: number }>()
const container = ref<HTMLElement | null>(null)
const tileError = ref(false)
let map: L.Map | null = null

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
  map?.remove()
  map = null
  tileError.value = false
  await nextTick()
  if (!container.value || !props.boundary.features.length) return

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
  streets.addTo(map)
  L.control.layers({ Straßenkarte: streets, Satellit: satellite }).addTo(map)

  const mask = buildMask(props.boundary)
  if (mask) {
    L.geoJSON(mask, {
      style: { color: 'transparent', weight: 0, fillColor: '#101821', fillOpacity: 0.5, fillRule: 'evenodd' },
    }).addTo(map)
  }
  const boundaryLayer = L.geoJSON(props.boundary, {
    style: { color: '#2f6b32', weight: 3, fillColor: '#2dd36f', fillOpacity: 0.08 },
  }).addTo(map)
  const bounds = boundaryLayer.getBounds()
  requestAnimationFrame(() => {
    map?.invalidateSize()
    if (bounds.isValid()) map?.fitBounds(bounds, { padding: [24, 24] })
  })
}

watch(() => props.boundary, renderMap)
onMounted(renderMap)
onBeforeUnmount(() => map?.remove())
</script>

<template>
  <div ref="container" class="revier-map"></div>
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

.map-error {
  color: var(--ion-color-danger);
}

</style>
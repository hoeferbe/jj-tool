<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as L from 'leaflet'
import {
  IonAccordion,
  IonAccordionGroup,
  IonBadge,
  IonButton,
  IonCheckbox,
  IonInput,
  IonItem,
  IonLabel,
  IonList,
  IonModal,
  IonNote,
} from '@ionic/vue'
import AppLayout from '../components/AppLayout.vue'
import BkgAttribution from '../components/BkgAttribution.vue'
import NewRevierDialog from '../components/NewRevierDialog.vue'

const apiUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:8787'

interface GeoJsonFeatureCollection {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    properties?: Record<string, unknown>;
    geometry: {
      type: string;
      coordinates: unknown;
    };
  }>;
}

interface Revier {
  id: string;
  name: string;
  municipalityName: string;
  municipalityCode?: string;
  center: { lat: number; lng: number };
  boundary: GeoJsonFeatureCollection;
  source: 'bkg-wfs-vg25';
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

/** Mirror of the server-side UserRole type for type-safe template bindings. */
type UserRole = 'admin' | 'paechter' | 'bgs' | 'guest'
/** Mirror of the server-side UserPosition type. */
type UserPosition = 'revierleiter' | 'kassenwart' | 'schriftfuehrer'
interface RevierMembership {
  revierId: string
  status: 'active' | 'pending'
  memberType: Exclude<UserRole, 'admin'>
  position?: UserPosition
  isAdmin: boolean
}

/** User record returned by GET /admin/users (passwordHash is never included). */
interface User {
  id: string
  username: string
  email: string
  displayName: string
  accountType: 'systemAdmin' | 'member'
  status: 'active' | 'pending' | 'blocked'
  memberships: RevierMembership[]
  lastLoginAt?: string
  createdAt: string
  /** Derived server-side from active sessions; not persisted in auth.json. */
  isOnline: boolean
}

/** Human-readable role labels for badges and select options. */
const ROLE_LABELS: Record<string, string> = {
  guest: 'Gast',
  paechter: 'Pächter',
  bgs: 'BGS',
  admin: 'Admin',
}

/** Ionic colour names for role badges (must match the theme palette). */
const ROLE_COLORS: Record<string, string> = {
  admin: 'primary',
  paechter: 'secondary',
  bgs: 'tertiary',
  guest: 'warning',
}

/** Human-readable position labels. */
const POSITION_LABELS: Record<string, string> = {
  revierleiter: 'Revierleiter',
  kassenwart: 'Kassenwart',
  schriftfuehrer: 'Schriftführer',
}

const users = ref<User[]>([])
const currentUser = ref<User | null>(null)
const errorMessage = ref('')
const reviere = ref<Revier[]>([])
const reviereLoading = ref(false)
const revierSaving = ref(false)
const revierDeleting = ref(false)
const revierMode = ref<'view' | 'edit'>('view')
const revierDraftName = ref('')
const showNewRevierModal = ref(false)
const showInvitationModal = ref(false)
const invitationEmail = ref('')
const invitationMessage = ref('')
const invitationSending = ref(false)
const newRevierName = ref('')
const municipalityQuery = ref('')
const municipalitySearching = ref(false)
const newMunicipalityName = ref('')
const newMunicipalityCode = ref('')
const newBoundary = ref<GeoJsonFeatureCollection | null>(null)
const newCenter = ref<{ lat: number; lng: number } | null>(null)
const newRevierError = ref('')
const mapContainer = ref<HTMLElement | null>(null)
const modalMapContainer = ref<HTMLElement | null>(null)
const detailMapError = ref('')
const modalMapError = ref('')
const selectedRevierId = ref<string | null>(null)
const revierAccordionOpen = ref<string[]>([])
const editingUserReviereId = ref<string | null>(null)
const userRevierDraft = ref<string[]>([])
const memberActionId = ref<string | null>(null)
/** Tracks which user is currently being approved to disable the button during the request. */
const approvingId = ref<string | null>(null)
/** Per-user role/position/isAdmin selections for the approval form. Keyed by user ID. */
const approvalData = ref<Record<string, { role: string; position: string; isAdmin: boolean; revierIds: string[] }>>({})

let mapInstance: L.Map | null = null
let boundaryLayer: L.GeoJSON | null = null
let maskLayer: L.GeoJSON | null = null
let modalMapInstance: L.Map | null = null
let modalBoundaryLayer: L.GeoJSON | null = null
let modalMaskLayer: L.GeoJSON | null = null
const dashboardAccordionStorageKey = 'jj-dashboard-accordions'
const selectedRevierStorageKey = 'jj-selected-revier'

const pendingUsers = computed(() => users.value.filter((u) => u.status === 'pending'))
const activeUsers = computed(() => users.value.filter((u) => u.status !== 'pending'))
const selectedRevier = computed(() => reviere.value.find((revier) => revier.id === selectedRevierId.value) ?? null)
const canAdministerSelectedRevier = computed(() => {
  if (!currentUser.value || !selectedRevier.value) return false
  return currentUser.value.accountType === 'systemAdmin'
    || currentUser.value.memberships.some((membership) =>
      membership.revierId === selectedRevier.value?.id
      && membership.status === 'active'
      && membership.isAdmin,
    )
})
const isCurrentSystemAdmin = computed(() => currentUser.value?.accountType === 'systemAdmin')
const administrableReviere = computed(() => {
  if (isCurrentSystemAdmin.value) return reviere.value
  const adminIds = new Set(
    currentUser.value?.memberships
      .filter((membership) => membership.status === 'active' && membership.isAdmin)
      .map((membership) => membership.revierId) ?? [],
  )
  return reviere.value.filter((revier) => adminIds.has(revier.id))
})

function hasFullAccess(user: User) {
  return user.accountType === 'systemAdmin'
}

function membershipRevierName(membership: RevierMembership) {
  return reviere.value.find((revier) => revier.id === membership.revierId)?.name ?? 'Unbekanntes Revier'
}

function canManageMembership(membership: RevierMembership) {
  return isCurrentSystemAdmin.value || currentUser.value?.memberships.some(
    (entry) =>
      entry.revierId === membership.revierId &&
      entry.status === 'active' &&
      entry.isAdmin,
  ) === true
}

function buildDimmedMask(boundary: GeoJsonFeatureCollection) {
  const holeRings: number[][][] = []

  for (const feature of boundary.features) {
    const geometry = feature.geometry as {
      type?: string;
      coordinates?: unknown;
    }
    if (!geometry || !geometry.type || !geometry.coordinates) continue

    if (geometry.type === 'Polygon') {
      const polygonCoordinates = geometry.coordinates as number[][][]
      if (polygonCoordinates[0]) holeRings.push(polygonCoordinates[0])
    }

    if (geometry.type === 'MultiPolygon') {
      const polygons = geometry.coordinates as number[][][][]
      for (const polygon of polygons) {
        if (polygon[0]) holeRings.push(polygon[0])
      }
    }
  }

  if (holeRings.length === 0) return null

  const worldBounds: number[][] = [
    [-180, -85],
    [180, -85],
    [180, 85],
    [-180, 85],
    [-180, -85],
  ]

  return {
    type: 'FeatureCollection' as const,
    features: [
      {
        type: 'Feature' as const,
        properties: {},
        geometry: {
          type: 'Polygon' as const,
          coordinates: [worldBounds, ...holeRings],
        },
      },
    ],
  }
}

function addBoundaryToMap(map: L.Map, boundary: GeoJsonFeatureCollection, dimOutside = true) {
  const dimmedMask = dimOutside ? buildDimmedMask(boundary) : null
  const dimmer = dimmedMask
    ? L.geoJSON(dimmedMask, {
        style: {
          color: 'transparent',
          weight: 0,
          fillColor: '#101821',
          fillOpacity: 0.5,
          fillRule: 'evenodd',
        },
      }).addTo(map)
    : null
  const outline = L.geoJSON(boundary, {
    style: {
      color: '#2f6b32',
      weight: 3,
      fillColor: '#2dd36f',
      fillOpacity: 0.08,
    },
  }).addTo(map)
  const bounds = outline.getBounds()
  if (bounds.isValid()) {
    map.fitBounds(bounds, { padding: [24, 24] })
  }
  return { outline, dimmer }
}

function createMap(container: HTMLElement, onTileError: () => void, interactive = true) {
  const map = L.map(container, {
    zoomControl: interactive,
    attributionControl: interactive,
    dragging: interactive,
    touchZoom: interactive,
    scrollWheelZoom: interactive,
    doubleClickZoom: interactive,
    boxZoom: interactive,
    keyboard: interactive,
  })
  const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
  })
  const satelliteLayer = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { attribution: 'Tiles &copy; Esri' },
  )
  osmLayer.on('tileerror', onTileError)
  satelliteLayer.on('tileerror', onTileError)
  osmLayer.addTo(map)
  if (interactive) {
    L.control.layers({ Straßenkarte: osmLayer, Satellit: satelliteLayer }).addTo(map)
  }
  return map
}

function persistAccordionState() {
  localStorage.setItem(dashboardAccordionStorageKey, JSON.stringify(revierAccordionOpen.value))
}

function restoreAccordionState() {
  try {
    const stored = localStorage.getItem(dashboardAccordionStorageKey)
    if (!stored) return
    const parsed = JSON.parse(stored) as string[]
    if (Array.isArray(parsed)) revierAccordionOpen.value = parsed
  } catch {
    revierAccordionOpen.value = []
  }
}

function onDashboardAccordionChange(event: CustomEvent<{ value: string[] }>) {
  revierAccordionOpen.value = event.detail.value
  persistAccordionState()
}

function destroyDetailMap() {
  mapInstance?.remove()
  mapInstance = null
  boundaryLayer = null
  maskLayer = null
}

function destroyModalMap() {
  modalMapInstance?.remove()
  modalMapInstance = null
  modalBoundaryLayer = null
  modalMaskLayer = null
}

async function renderSelectedRevierMap() {
  destroyDetailMap()
  detailMapError.value = ''
  if (!selectedRevier.value) return
  await nextTick()
  if (!mapContainer.value || !selectedRevier.value) return
  mapInstance = createMap(mapContainer.value, () => {
    detailMapError.value = 'Die Kartenkacheln konnten nicht geladen werden.'
  }, false)
  const layers = addBoundaryToMap(mapInstance, selectedRevier.value.boundary, false)
  boundaryLayer = layers.outline
  maskLayer = layers.dimmer
  requestAnimationFrame(() => {
    mapInstance?.invalidateSize()
    if (boundaryLayer?.getBounds().isValid()) mapInstance?.fitBounds(boundaryLayer.getBounds(), { padding: [24, 24] })
  })
}

watch(selectedRevier, renderSelectedRevierMap)

async function loadReviere() {
  reviereLoading.value = true
  const token = localStorage.getItem('accessToken')
  try {
    const response = await fetch(`${apiUrl}/reviere`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    })
    if (!response.ok) throw new Error('Reviere konnten nicht geladen werden.')
    const data = (await response.json()) as { reviere: Revier[] }
    reviere.value = data.reviere
    const storedId = localStorage.getItem(selectedRevierStorageKey)
    selectedRevierId.value = data.reviere.some((revier) => revier.id === storedId) ? storedId : null
    if (!selectedRevierId.value) localStorage.removeItem(selectedRevierStorageKey)
  } catch {
    errorMessage.value = 'Reviere konnten nicht geladen werden.'
  } finally {
    reviereLoading.value = false
  }
}

function selectRevier(revier: Revier) {
  selectedRevierId.value = revier.id
  revierMode.value = 'view'
  localStorage.setItem(selectedRevierStorageKey, revier.id)
}

function startEditingRevier() {
  if (!selectedRevier.value) return
  revierDraftName.value = selectedRevier.value.name
  revierMode.value = 'edit'
}

function cancelEditingRevier() {
  revierMode.value = 'view'
  revierDraftName.value = ''
}

async function saveCurrentRevier() {
  const current = selectedRevier.value
  if (!current || revierDraftName.value.trim().length < 2) return
  revierSaving.value = true
  const token = localStorage.getItem('accessToken')
  const payload = {
    name: revierDraftName.value.trim(),
    municipalityName: current.municipalityName,
    municipalityCode: current.municipalityCode,
    center: current.center,
    boundary: current.boundary,
    source: current.source,
  }

  try {
    const response = await fetch(`${apiUrl}/reviere/${current.id}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })
    const data = await response.json() as { message?: string; revier?: Revier }
    if (!response.ok) {
      errorMessage.value = data.message ?? 'Revier konnte nicht gespeichert werden.'
      return
    }
    if (data.revier) {
      reviere.value = reviere.value.map((revier) => revier.id === data.revier?.id ? data.revier : revier)
      revierMode.value = 'view'
      errorMessage.value = ''
    }
  } catch {
    errorMessage.value = 'API-Server nicht erreichbar. Revier konnte nicht gespeichert werden.'
  } finally {
    revierSaving.value = false
  }
}

function openNewRevierDialog() {
  newRevierName.value = ''
  municipalityQuery.value = ''
  newMunicipalityName.value = ''
  newMunicipalityCode.value = ''
  newBoundary.value = null
  newCenter.value = null
  newRevierError.value = ''
  modalMapError.value = ''
  showNewRevierModal.value = true
}

function closeNewRevierDialog() {
  showNewRevierModal.value = false
  destroyModalMap()
}

function handleCreatedRevier(revier: Revier) {
  reviere.value = [...reviere.value, revier]
  selectRevier(revier)
  loadCurrentUser()
}

async function searchMunicipality() {
  if (!municipalityQuery.value.trim()) return
  municipalitySearching.value = true
  newRevierError.value = ''
  destroyModalMap()
  newBoundary.value = null
  const token = localStorage.getItem('accessToken')
  try {
    const response = await fetch(`${apiUrl}/municipalities/search?name=${encodeURIComponent(municipalityQuery.value.trim())}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const data = await response.json() as { municipalityName?: string; municipalityCode?: string; boundary?: GeoJsonFeatureCollection; message?: string }
    if (!response.ok || !data.boundary) {
      newRevierError.value = data.message ?? 'Gemeinde konnte nicht gefunden werden.'
      return
    }
    newMunicipalityName.value = data.municipalityName ?? municipalityQuery.value.trim()
    newMunicipalityCode.value = data.municipalityCode ?? ''
    newBoundary.value = data.boundary
    const bounds = L.geoJSON(data.boundary).getBounds()
    if (bounds.isValid()) {
      const center = bounds.getCenter()
      newCenter.value = { lat: center.lat, lng: center.lng }
    }
    await nextTick()
    if (!modalMapContainer.value) return
    modalMapInstance = createMap(modalMapContainer.value, () => {
      modalMapError.value = 'Die Kartenkacheln konnten nicht geladen werden.'
    })
    const layers = addBoundaryToMap(modalMapInstance, data.boundary)
    modalBoundaryLayer = layers.outline
    modalMaskLayer = layers.dimmer
    requestAnimationFrame(() => {
      modalMapInstance?.invalidateSize()
      if (modalBoundaryLayer?.getBounds().isValid()) {
        modalMapInstance?.fitBounds(modalBoundaryLayer.getBounds(), { padding: [24, 24] })
      }
    })
  } catch {
    newRevierError.value = 'API-Server nicht erreichbar. Gemeinde konnte nicht gesucht werden.'
  } finally {
    municipalitySearching.value = false
  }
}

async function createRevier() {
  if (newRevierName.value.trim().length < 2 || !newBoundary.value || !newCenter.value) return
  revierSaving.value = true
  const token = localStorage.getItem('accessToken')
  try {
    const response = await fetch(`${apiUrl}/reviere`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: newRevierName.value.trim(),
        municipalityName: newMunicipalityName.value,
        municipalityCode: newMunicipalityCode.value || undefined,
        center: newCenter.value,
        boundary: newBoundary.value,
        source: 'bkg-wfs-vg25',
      }),
    })
    const data = await response.json() as { message?: string; revier?: Revier }
    if (!response.ok || !data.revier) {
      newRevierError.value = data.message ?? 'Revier konnte nicht angelegt werden.'
      return
    }
    reviere.value = [...reviere.value, data.revier]
    selectRevier(data.revier)
    closeNewRevierDialog()
  } catch {
    newRevierError.value = 'API-Server nicht erreichbar. Revier konnte nicht angelegt werden.'
  } finally {
    revierSaving.value = false
  }
}

async function deleteSelectedRevier() {
  const id = selectedRevierId.value
  if (!id) return
  const confirmed = window.confirm('Soll dieses Revier gelöscht werden?')
  if (!confirmed) return
  revierDeleting.value = true
  const token = localStorage.getItem('accessToken')
  try {
    const response = await fetch(`${apiUrl}/reviere/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!response.ok) {
      errorMessage.value = 'Revier konnte nicht gelöscht werden.'
      return
    }
    reviere.value = reviere.value.filter((revier) => revier.id !== id)
    selectedRevierId.value = null
    revierMode.value = 'view'
    localStorage.removeItem(selectedRevierStorageKey)
    errorMessage.value = ''
  } catch {
    errorMessage.value = 'API-Server nicht erreichbar. Revier konnte nicht gelöscht werden.'
  } finally {
    revierDeleting.value = false
  }
}

/**
 * Fetches the current user list from the API and updates reactive state.
 * Also initialises approvalData entries for any new pending users.
 * cache: 'no-store' prevents the browser from returning stale data.
 */
async function loadUsers() {
  const token = localStorage.getItem('accessToken')
  try {
    const response = await fetch(`${apiUrl}/admin/users`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    })
    if (!response.ok) {
      errorMessage.value = 'Benutzer konnten nicht geladen werden.'
      return
    }
    const data = (await response.json()) as { users: User[] }
    users.value = data.users
    if (data.users.some((user) => user.status === 'pending') && !revierAccordionOpen.value.includes('pending')) {
      revierAccordionOpen.value = [...revierAccordionOpen.value, 'pending']
      persistAccordionState()
    }
    // Seed approvalData for every pending user that doesn't have an entry yet.
    for (const user of data.users.filter((u) => u.status === 'pending')) {
      if (!approvalData.value[user.id]) {
        approvalData.value[user.id] = {
          role: 'paechter',
          position: '',
          isAdmin: false,
          revierIds: user.memberships.map((membership) => membership.revierId),
        }
      }
    }
  } catch {
    errorMessage.value = 'API-Server nicht erreichbar. Bitte Server starten und erneut versuchen.'
  }
}

async function loadCurrentUser() {
  const token = localStorage.getItem('accessToken')
  const response = await fetch(`${apiUrl}/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  })
  if (response.ok) {
    currentUser.value = ((await response.json()) as { user: User }).user
  }
}

/**
 * Approves a pending registration using the role/position/isAdmin chosen in the form.
 * On success the server sends the password-setup e-mail to the user.
 */
async function approveUser(userId: string) {
  approvingId.value = userId
  const token = localStorage.getItem('accessToken')
  const ad = approvalData.value[userId] ?? { role: 'paechter', position: '', isAdmin: false, revierIds: [] }
  // Only include position and isAdmin in the payload when they are set.
  const body: Record<string, string | boolean | string[]> = {
    role: ad.role,
    revierIds: ad.isAdmin ? [] : ad.revierIds,
  }
  if (ad.position && !ad.isAdmin) body.position = ad.position
  if (ad.isAdmin) body.isAdmin = true
  const user = users.value.find((candidate) => candidate.id === userId)
  try {
    if (user?.memberships.length) {
      const selectedIds = new Set(ad.revierIds)
      const memberships = user.memberships.filter((membership) => selectedIds.has(membership.revierId))
      if (!memberships.length) throw new Error('Bitte mindestens ein beantragtes Revier auswählen.')
      for (const membership of memberships) {
        await updateMembership(user.id, membership.revierId, {
          memberType: ad.role,
          position: ad.position || undefined,
          isAdmin: ad.isAdmin,
          status: 'active',
        })
      }
      await loadUsers()
    } else {
      const response = await fetch(`${apiUrl}/admin/users/${userId}/approve`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!response.ok) {
        const data = (await response.json()) as { message?: string }
        throw new Error(data.message ?? 'Freigabe fehlgeschlagen.')
      }
      await loadUsers()
    }
  } catch (error) {
    errorMessage.value = (error as Error).message
  } finally {
    approvingId.value = null
  }
}

function openInvitationDialog() {
  invitationEmail.value = ''
  invitationMessage.value = ''
  showInvitationModal.value = true
}

async function sendInvitation() {
  if (!selectedRevier.value || !invitationEmail.value.trim()) return
  invitationSending.value = true
  invitationMessage.value = ''
  const token = localStorage.getItem('accessToken')
  try {
    const response = await fetch(`${apiUrl}/reviere/${selectedRevier.value.id}/invitations`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: invitationEmail.value.trim() }),
    })
    const data = await response.json() as { message?: string }
    if (!response.ok) throw new Error(data.message ?? 'Einladung konnte nicht versendet werden.')
    invitationMessage.value = data.message ?? 'Einladung wurde versendet.'
  } catch (error) {
    invitationMessage.value = (error as Error).message
  } finally {
    invitationSending.value = false
  }
}

/**
 * Permanently removes a pending registration (reject).
 * This cannot be undone; the user would need to re-register.
 */
async function rejectUser(userId: string) {
  const token = localStorage.getItem('accessToken')
  const user = users.value.find((candidate) => candidate.id === userId)
  try {
    if (user?.memberships.length) {
      await Promise.all(user.memberships.map((membership) => updateMembership(userId, membership.revierId, null)))
      await loadUsers()
      return
    }
    const response = await fetch(`${apiUrl}/admin/users/${userId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!response.ok) {
      const data = (await response.json()) as { message?: string }
      throw new Error(data.message ?? 'Ablehnung fehlgeschlagen.')
    }
    await loadUsers()
  } catch (error) {
    errorMessage.value = (error as Error).message
  }
}

/**
 * Updates an existing member's role, position, and/or isAdmin flag via PATCH.
 * Only fields that are explicitly set are sent in the request body.
 * @param isAdmin - Pass `undefined` to leave the existing value unchanged.
 */
async function updateUserRoleAndPosition(
  userId: string,
  role: string,
  position: string,
  isAdmin?: boolean,
  revierIds?: string[],
) {
  const token = localStorage.getItem('accessToken')
  const body: Record<string, string | boolean | string[]> = { role }
  if (position) body.position = position
  // Only send isAdmin when the caller explicitly passes a value.
  if (isAdmin !== undefined) body.isAdmin = isAdmin
  if (revierIds !== undefined) body.revierIds = revierIds
  const response = await fetch(`${apiUrl}/admin/users/${userId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (response.ok) {
    await loadUsers()
  } else {
    const data = (await response.json()) as { message?: string }
    errorMessage.value = data.message ?? 'Aktualisierung fehlgeschlagen.'
  }
}

function startUserRevierEdit(userId: string, revierIds: string[]) {
  editingUserReviereId.value = userId
  userRevierDraft.value = [...revierIds]
}

function toggleUserRevierDraft(revierId: string) {
  userRevierDraft.value = userRevierDraft.value.includes(revierId)
    ? userRevierDraft.value.filter((id) => id !== revierId)
    : [...userRevierDraft.value, revierId]
}

function cancelUserRevierEdit() {
  editingUserReviereId.value = null
  userRevierDraft.value = []
}

function savePendingUserReviere(userId: string) {
  const data = approvalData.value[userId]
  if (data) data.revierIds = [...userRevierDraft.value]
  cancelUserRevierEdit()
}

async function saveMemberReviere(user: User) {
  memberActionId.value = user.id
  const currentIds = new Set(user.memberships.map((membership) => membership.revierId))
  const draftIds = new Set(userRevierDraft.value)
  await Promise.all([
    ...user.memberships
      .filter((membership) => !draftIds.has(membership.revierId))
      .map((membership) => updateMembership(user.id, membership.revierId, null)),
    ...userRevierDraft.value
      .filter((revierId) => !currentIds.has(revierId))
      .map((revierId) => updateMembership(user.id, revierId, {
        memberType: 'paechter', status: 'active', isAdmin: false,
      })),
  ])
  await loadUsers()
  memberActionId.value = null
  cancelUserRevierEdit()
}

async function updateMembership(
  userId: string,
  revierId: string,
  membership: { memberType: string; position?: string; isAdmin: boolean; status: string } | null,
) {
  const token = localStorage.getItem('accessToken')
  const response = await fetch(`${apiUrl}/reviere/${revierId}/members/${userId}`, {
    method: membership ? 'PUT' : 'DELETE',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: membership ? JSON.stringify(membership) : undefined,
  })
  if (!response.ok) {
    const data = await response.json() as { message?: string }
    throw new Error(data.message ?? 'Mitgliedschaft konnte nicht geändert werden.')
  }
}

async function changeMembership(user: User, membership: RevierMembership, changes: Partial<RevierMembership>) {
  memberActionId.value = user.id
  try {
    await updateMembership(user.id, membership.revierId, { ...membership, ...changes })
    await loadUsers()
  } catch (error) {
    errorMessage.value = (error as Error).message
  } finally {
    memberActionId.value = null
  }
}

async function setMemberBlocked(user: User, blocked: boolean) {
  const confirmed = window.confirm(
    blocked
      ? `Soll ${user.displayName} gesperrt werden?`
      : `Soll ${user.displayName} entsperrt werden?`,
  )
  if (!confirmed) return
  memberActionId.value = user.id
  const token = localStorage.getItem('accessToken')
  const response = await fetch(`${apiUrl}/admin/users/${user.id}/status`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ blocked }),
  })
  memberActionId.value = null
  if (response.ok) await loadUsers()
  else errorMessage.value = ((await response.json()) as { message?: string }).message ?? 'Status konnte nicht geändert werden.'
}

async function deleteMember(user: User) {
  if (!window.confirm(`Soll ${user.displayName} dauerhaft gelöscht werden?`)) return
  memberActionId.value = user.id
  const token = localStorage.getItem('accessToken')
  const response = await fetch(`${apiUrl}/admin/users/${user.id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })
  memberActionId.value = null
  if (response.ok) await loadUsers()
  else errorMessage.value = ((await response.json()) as { message?: string }).message ?? 'Mitglied konnte nicht gelöscht werden.'
}

/** Handles native <select> change for the role field; preserves the current position. */
function onUserRoleChange(userId: string, position: string | undefined, e: Event) {
  const role = (e.target as HTMLSelectElement).value
  updateUserRoleAndPosition(userId, role, position ?? '')
}

/** Handles native <select> change for the position field; preserves the current role. */
function onUserPositionChange(userId: string, role: string, e: Event) {
  updateUserRoleAndPosition(userId, role, (e.target as HTMLSelectElement).value)
}

/** Handles the IonCheckbox change event for the admin-rights toggle. */
function onAdminFlagChange(userId: string, role: string, position: string | undefined, e: Event) {
  const isAdmin = (e as CustomEvent<{ checked: boolean }>).detail.checked
  updateUserRoleAndPosition(userId, role, isAdmin ? '' : position ?? '', isAdmin, isAdmin ? [] : undefined)
}

/** Formats an ISO timestamp for display in German locale; returns 'Noch nie' if absent. */
function formatDate(iso?: string) {
  if (!iso) return 'Noch nie'
  return new Date(iso).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' })
}

onMounted(() => {
  restoreAccordionState()
  loadCurrentUser()
  loadUsers()
  loadReviere()
})

onBeforeUnmount(() => {
  destroyDetailMap()
  destroyModalMap()
})
</script>

<template>
  <AppLayout>
    <div class="ion-padding-horizontal ion-padding-top">
      <IonButton fill="outline" size="small" @click="loadUsers">Aktualisieren</IonButton>
    </div>
    <p v-if="errorMessage" class="ion-padding" style="color: var(--ion-color-danger)">{{ errorMessage }}</p>

    <IonAccordionGroup :multiple="true" :value="revierAccordionOpen" @ion-change="onDashboardAccordionChange">
      <IonAccordion value="pending">
        <IonItem slot="header" color="light">
          <IonLabel>Ausstehende Registrierungen</IonLabel>
          <IonBadge v-if="pendingUsers.length" slot="end" color="warning">{{ pendingUsers.length }}</IonBadge>
        </IonItem>
        <IonList slot="content">
          <IonItem v-if="!pendingUsers.length">
            <IonLabel><IonNote>Keine ausstehenden Registrierungen.</IonNote></IonLabel>
          </IonItem>
          <div v-else class="user-grid-list">
            <div class="user-grid user-grid-header" aria-hidden="true">
              <span>Anwender</span>
              <span>Rolle und Rechte</span>
              <span>Reviere</span>
              <span>Aktionen</span>
            </div>
            <article v-for="user in pendingUsers" :key="user.id" class="user-grid">
              <div class="user-info">
                <h3>{{ user.displayName }}</h3>
                <p>{{ user.email }}</p>
                <p>@{{ user.username }}</p>
                <p>{{ formatDate(user.createdAt) }}</p>
                <IonBadge color="warning">Ausstehend</IonBadge>
              </div>
              <div v-if="approvalData[user.id]" class="role-controls">
                <div class="field-group">
                  <span class="field-label">Rolle</span>
                  <select v-model="approvalData[user.id].role" class="native-select">
                    <option value="guest">Gast</option>
                    <option value="paechter">Pächter</option>
                    <option value="bgs">BGS</option>
                  </select>
                </div>
                <div class="field-group">
                  <span class="field-label">Funktion</span>
                  <select v-model="approvalData[user.id].position" class="native-select" :disabled="approvalData[user.id].isAdmin">
                    <option value="">Keine</option>
                    <option value="revierleiter">Revierleiter</option>
                    <option value="kassenwart">Kassenwart</option>
                    <option value="schriftfuehrer">Schriftführer</option>
                  </select>
                </div>
                <IonCheckbox
                  v-model="approvalData[user.id].isAdmin"
                  :disabled="approvalData[user.id].role === 'guest'"
                  class="admin-checkbox"
                >Admin-Rechte</IonCheckbox>
              </div>
              <div class="revier-assignment">
                <template v-if="approvalData[user.id].isAdmin">
                  <IonBadge color="primary">Alle Reviere</IonBadge>
                  <IonNote>Vollzugriff durch Admin-Rechte</IonNote>
                </template>
                <template v-else-if="editingUserReviereId === user.id">
                  <div v-if="reviere.length" class="revier-chips revier-chip-editor">
                    <button
                      v-for="revier in administrableReviere"
                      :key="revier.id"
                      type="button"
                      class="revier-chip"
                      :class="{ selected: userRevierDraft.includes(revier.id) }"
                      :aria-pressed="userRevierDraft.includes(revier.id)"
                      @click="toggleUserRevierDraft(revier.id)"
                    >
                      {{ revier.name }}
                    </button>
                  </div>
                  <IonNote v-else>Keine Reviere angelegt</IonNote>
                  <div class="inline-actions">
                    <IonButton size="small" @click="savePendingUserReviere(user.id)">Übernehmen</IonButton>
                    <IonButton size="small" fill="clear" @click="cancelUserRevierEdit">Abbrechen</IonButton>
                  </div>
                </template>
                <template v-else>
                  <div v-if="approvalData[user.id].revierIds.length" class="assigned-reviere">
                    <IonBadge
                      v-for="revier in reviere.filter((item) => approvalData[user.id].revierIds.includes(item.id))"
                      :key="revier.id"
                      color="medium"
                    >{{ revier.name }}</IonBadge>
                  </div>
                  <IonNote v-else>Noch kein Revier</IonNote>
                  <IonButton size="small" fill="clear" @click="startUserRevierEdit(user.id, approvalData[user.id].revierIds)">Bearbeiten</IonButton>
                </template>
              </div>
              <div class="action-buttons">
              <IonButton size="small" :disabled="approvingId === user.id" @click="approveUser(user.id)">Freigeben</IonButton>
              <IonButton size="small" color="danger" fill="outline" @click="rejectUser(user.id)">Ablehnen</IonButton>
              </div>
            </article>
          </div>
        </IonList>
      </IonAccordion>

      <IonAccordion value="members">
        <IonItem slot="header" color="light">
          <IonLabel>Mitglieder</IonLabel>
          <IonBadge v-if="activeUsers.length" slot="end">{{ activeUsers.length }}</IonBadge>
        </IonItem>
        <IonList slot="content">
          <IonItem v-if="!activeUsers.length">
            <IonLabel><IonNote>Keine Mitglieder vorhanden.</IonNote></IonLabel>
          </IonItem>
          <div v-else class="user-grid-list">
            <div class="user-grid user-grid-header" aria-hidden="true">
              <span>Anwender</span>
              <span>Rolle und Rechte</span>
              <span>Reviere</span>
              <span>Aktionen</span>
            </div>
            <article v-for="user in activeUsers" :key="user.id" class="user-grid" :class="{ blocked: user.status === 'blocked' }">
              <div class="user-info">
                <div class="user-name-status">
                  <span class="online-dot" :class="{ online: user.isOnline && user.status === 'active' }"></span>
                  <h3>{{ user.displayName }}</h3>
                </div>
                <p>{{ user.email }}</p>
                <p>@{{ user.username }}</p>
                <p>Zuletzt aktiv: {{ formatDate(user.lastLoginAt) }}</p>
                <IonBadge :color="user.status === 'blocked' ? 'danger' : 'success'">
                  {{ user.status === 'blocked' ? 'Gesperrt' : 'Aktiv' }}
                </IonBadge>
              </div>
              <div class="role-controls">
                <template v-if="!hasFullAccess(user)">
                  <div v-for="membership in user.memberships" :key="membership.revierId" class="membership-controls">
                    <strong>{{ membershipRevierName(membership) }}</strong>
                    <template v-if="canManageMembership(membership)">
                      <div class="field-group">
                        <span class="field-label">Typ</span>
                        <select class="native-select" :value="membership.memberType" @change="changeMembership(user, membership, { memberType: ($event.target as HTMLSelectElement).value as RevierMembership['memberType'] })">
                          <option value="guest">Gast</option>
                          <option value="paechter">Pächter</option>
                          <option value="bgs">BGS</option>
                        </select>
                      </div>
                      <div class="field-group">
                        <span class="field-label">Funktion</span>
                        <select class="native-select" :value="membership.position ?? ''" @change="changeMembership(user, membership, { position: (($event.target as HTMLSelectElement).value || undefined) as UserPosition | undefined })">
                          <option value="">Keine</option>
                          <option value="revierleiter">Revierleiter</option>
                          <option value="kassenwart">Kassenwart</option>
                          <option value="schriftfuehrer">Schriftführer</option>
                        </select>
                      </div>
                      <IonCheckbox :checked="membership.isAdmin" class="admin-checkbox" @ion-change="changeMembership(user, membership, { isAdmin: ($event as CustomEvent<{ checked: boolean }>).detail.checked })">Revieradmin</IonCheckbox>
                    </template>
                    <div v-else class="membership-summary">
                      <IonBadge color="medium">{{ ROLE_LABELS[membership.memberType] }}</IonBadge>
                      <span v-if="membership.position">{{ POSITION_LABELS[membership.position] }}</span>
                    </div>
                  </div>
                  <IonNote v-if="!user.memberships.length">Noch keine Mitgliedschaft</IonNote>
                </template>
                <template v-else>
                  <IonBadge color="danger">Administrator</IonBadge>
                  <IonNote>Vollzugriff</IonNote>
                </template>
              </div>
              <div class="revier-assignment">
                <template v-if="hasFullAccess(user)">
                  <IonBadge color="primary">Alle Reviere</IonBadge>
                  <IonNote>Keine Einzelzuordnung erforderlich</IonNote>
                </template>
                <template v-else-if="editingUserReviereId === user.id">
                  <div v-if="reviere.length" class="revier-chips revier-chip-editor">
                    <button
                      v-for="revier in administrableReviere"
                      :key="revier.id"
                      type="button"
                      class="revier-chip"
                      :class="{ selected: userRevierDraft.includes(revier.id) }"
                      :aria-pressed="userRevierDraft.includes(revier.id)"
                      @click="toggleUserRevierDraft(revier.id)"
                    >
                      {{ revier.name }}
                    </button>
                  </div>
                  <IonNote v-else>Keine Reviere angelegt</IonNote>
                  <div class="inline-actions">
                    <IonButton size="small" :disabled="memberActionId === user.id" @click="saveMemberReviere(user)">Speichern</IonButton>
                    <IonButton size="small" fill="clear" :disabled="memberActionId === user.id" @click="cancelUserRevierEdit">Abbrechen</IonButton>
                  </div>
                </template>
                <template v-else>
                  <div v-if="user.memberships.length" class="assigned-reviere">
                    <IonBadge
                      v-for="membership in user.memberships"
                      :key="membership.revierId"
                      color="medium"
                    >{{ membershipRevierName(membership) }}</IonBadge>
                  </div>
                  <IonNote v-else>Noch kein Revier</IonNote>
                  <IonButton size="small" fill="clear" @click="startUserRevierEdit(user.id, user.memberships.map((membership) => membership.revierId))">Bearbeiten</IonButton>
                </template>
              </div>
              <div v-if="isCurrentSystemAdmin && user.accountType !== 'systemAdmin'" class="action-buttons">
                <IonButton
                  size="small"
                  :color="user.status === 'blocked' ? 'success' : 'warning'"
                  fill="outline"
                  :disabled="memberActionId === user.id"
                  @click="setMemberBlocked(user, user.status !== 'blocked')"
                >{{ user.status === 'blocked' ? 'Entsperren' : 'Sperren' }}</IonButton>
                <IonButton size="small" color="danger" fill="clear" :disabled="memberActionId === user.id" @click="deleteMember(user)">Löschen</IonButton>
              </div>
              <div v-else-if="user.accountType === 'systemAdmin'" class="action-buttons">
                <IonNote>Systemadministrator</IonNote>
              </div>
              <div v-else class="action-buttons">
                <IonNote>Revierbezogene Verwaltung</IonNote>
              </div>
            </article>
          </div>
        </IonList>
      </IonAccordion>

      <IonAccordion value="revier">
        <IonItem slot="header" color="light">
          <IonLabel>Reviere</IonLabel>
          <IonBadge v-if="reviere.length" slot="end" color="success">{{ reviere.length }}</IonBadge>
        </IonItem>
        <IonList slot="content">
          <IonItem v-if="reviereLoading">
            <IonLabel><IonNote>Reviere werden geladen...</IonNote></IonLabel>
          </IonItem>
          <IonItem v-else-if="!reviere.length">
            <IonLabel><IonNote>Keine Reviere angelegt.</IonNote></IonLabel>
          </IonItem>
          <div v-else class="revier-table">
            <div class="revier-table-row revier-table-header" aria-hidden="true">
              <span>Reviername</span>
              <span>Region</span>
              <span></span>
            </div>
            <button
              v-for="revier in reviere"
              :key="revier.id"
              type="button"
              class="revier-table-row revier-table-button"
              :class="{ selected: selectedRevierId === revier.id }"
              @click="selectRevier(revier)"
            >
              <strong>{{ revier.name }}</strong>
              <span>Gemeinde {{ revier.municipalityName }}</span>
              <IonBadge v-if="selectedRevierId === revier.id" color="success">Ausgewählt</IonBadge>
              <span v-else></span>
            </button>
          </div>
        </IonList>
      </IonAccordion>

    </IonAccordionGroup>

    <div class="ion-padding">
      <div class="revier-card">
        <div class="revier-heading">
          <h2>Revier</h2>
          <div class="revier-heading-actions">
            <IonBadge v-if="revierMode === 'edit'" color="warning">Bearbeitungsmodus</IonBadge>
            <IonButton v-if="selectedRevier && canAdministerSelectedRevier" size="small" fill="clear" @click="openInvitationDialog">Mitglied einladen</IonButton>
            <IonButton size="small" fill="outline" :disabled="revierMode === 'edit'" @click="openNewRevierDialog">Neues Revier</IonButton>
          </div>
        </div>
        <template v-if="selectedRevier">
          <div class="meta-row" :class="{ 'edit-mode': revierMode === 'edit' }">
            <div class="editable-field" :class="{ active: revierMode === 'edit' }">
              <strong>Reviername</strong>
              <IonInput v-if="revierMode === 'edit'" v-model="revierDraftName" aria-label="Reviername" />
              <p v-else>{{ selectedRevier.name }}</p>
            </div>
            <div>
              <strong>Region</strong>
              <p>Gemeinde {{ selectedRevier.municipalityName }}</p>
            </div>
          </div>
          <div ref="mapContainer" class="map-container"></div>
          <BkgAttribution :year="new Date(selectedRevier.createdAt).getFullYear()" />
          <p v-if="detailMapError" class="map-error">{{ detailMapError }}</p>
          <div class="save-row">
            <template v-if="revierMode === 'view' && canAdministerSelectedRevier">
              <IonButton @click="startEditingRevier">Bearbeiten</IonButton>
              <IonButton color="danger" fill="clear" :disabled="revierDeleting" @click="deleteSelectedRevier">
                {{ revierDeleting ? 'Löschen...' : 'Löschen' }}
              </IonButton>
            </template>
            <template v-else-if="revierMode === 'edit'">
              <IonButton :disabled="revierSaving || revierDraftName.trim().length < 2" @click="saveCurrentRevier">
                {{ revierSaving ? 'Speichern...' : 'Speichern' }}
              </IonButton>
              <IonButton fill="clear" :disabled="revierSaving" @click="cancelEditingRevier">Abbrechen</IonButton>
            </template>
          </div>
        </template>
        <div v-else class="empty-state">
          <div>
            <p>Bitte wählen Sie ein Revier aus.</p>
          </div>
        </div>
      </div>
    </div>

    <NewRevierDialog
      :is-open="showNewRevierModal"
      @close="showNewRevierModal = false"
      @created="handleCreatedRevier"
    />

    <IonModal :is-open="showInvitationModal" @didDismiss="showInvitationModal = false">
      <div class="modal-content compact-modal">
        <h2>Mitglied einladen</h2>
        <p v-if="selectedRevier">Einladung für {{ selectedRevier.name }}</p>
        <IonInput v-model="invitationEmail" type="email" label="E-Mail-Adresse" label-placement="stacked" autocomplete="email" />
        <IonNote v-if="invitationMessage">{{ invitationMessage }}</IonNote>
        <div class="modal-actions">
          <IonButton fill="clear" :disabled="invitationSending" @click="showInvitationModal = false">Schließen</IonButton>
          <IonButton :disabled="invitationSending || !invitationEmail.trim()" @click="sendInvitation">
            {{ invitationSending ? 'Senden...' : 'Einladung senden' }}
          </IonButton>
        </div>
      </div>
    </IonModal>
  </AppLayout>
</template>

<style scoped>
.revier-card {
  background: var(--ion-item-background, var(--ion-background-color, #fff));
  border: 1px solid var(--ion-color-light-shade, #dfe6dd);
  border-radius: 16px;
  padding: 16px;
}

.revier-card h2 {
  margin: 0;
}

.revier-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.revier-heading-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.revier-table {
  width: 100%;
}

.revier-table-row {
  display: grid;
  grid-template-columns: minmax(140px, 1fr) minmax(180px, 1.4fr) minmax(90px, auto);
  align-items: center;
  gap: 16px;
  min-height: 46px;
  padding: 8px 16px;
}

.revier-table-header {
  border-bottom: 1px solid var(--ion-color-light-shade, #dfe6dd);
  color: var(--ion-color-medium-shade, #5f6368);
  font-size: 0.78rem;
  font-weight: 700;
  text-transform: uppercase;
}

.revier-table-button {
  width: 100%;
  border: 0;
  border-bottom: 1px solid var(--ion-color-light, #f4f5f8);
  background: transparent;
  color: var(--ion-text-color, #222);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.revier-table-button:hover,
.revier-table-button:focus-visible {
  background: rgba(84, 111, 44, 0.08);
  outline: none;
}

.revier-table-button.selected {
  background: rgba(45, 211, 111, 0.1);
  box-shadow: inset 3px 0 var(--ion-color-success, #2dd36f);
}

.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 120px;
  margin-bottom: 12px;
  border: 1px dashed var(--ion-color-medium, #98a2b3);
  border-radius: 12px;
  background: rgba(152, 162, 179, 0.06);
  color: var(--ion-color-medium-shade, #5f6368);
  font-weight: 600;
}

.empty-state > div {
  text-align: center;
}

.search-row {
  display: flex;
  align-items: end;
  gap: 12px;
  margin-bottom: 12px;
}

.meta-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 12px;
  margin-bottom: 12px;
  padding: 2px;
  border: 1px solid transparent;
  transition: background-color 160ms ease, border-color 160ms ease;
}

.meta-row.edit-mode {
  padding: 12px;
  border-color: var(--ion-color-warning-shade, #d39e00);
  border-radius: 8px;
  background: rgba(255, 196, 9, 0.08);
}

.editable-field.active {
  padding: 8px 10px;
  border-left: 3px solid var(--ion-color-warning, #ffc409);
  background: var(--ion-background-color, #fff);
}

.meta-row p {
  margin: 8px 0 0;
}

.map-container {
  width: 100%;
  height: 240px;
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid var(--ion-color-light-shade, #dfe6dd);
  margin-bottom: 12px;
  background: rgba(63, 106, 66, 0.08);
}

.save-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.modal-content {
  padding: 20px;
  overflow-y: auto;
}

.modal-map {
  height: min(360px, 40vh);
  margin-top: 12px;
}

.municipality-result {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  margin-top: 16px;
}

.municipality-result span,
.map-error {
  color: var(--ion-color-medium-shade);
}

.dialog-error,
.map-error {
  margin-block: 8px;
}

.dialog-error {
  color: var(--ion-color-danger);
}

@media (max-width: 600px) {
  .revier-table-row {
    grid-template-columns: minmax(100px, 1fr) minmax(130px, 1.4fr) auto;
    gap: 8px;
    padding-inline: 10px;
    font-size: 0.85rem;
  }

  .revier-table-button ion-badge {
    display: none;
  }
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}

.user-grid-list {
  width: 100%;
}

.user-grid {
  display: grid;
  grid-template-columns: minmax(210px, 1.25fr) minmax(190px, 1fr) minmax(210px, 1.1fr) minmax(110px, auto);
  gap: 20px;
  align-items: start;
  padding: 16px;
  border-bottom: 1px solid var(--ion-color-light-shade, #dfe6dd);
}

.user-grid-header {
  min-height: auto;
  padding-block: 10px;
  background: var(--ion-color-light, #f4f5f8);
  color: var(--ion-color-medium-shade, #5f6368);
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
}

.user-grid.blocked {
  background: rgba(235, 68, 90, 0.05);
}

.user-info h3,
.user-info p {
  margin: 0 0 5px;
}

.user-info p {
  color: var(--ion-color-medium-shade, #5f6368);
  font-size: 0.85rem;
}

.user-name-status {
  display: flex;
  align-items: center;
  gap: 8px;
}

.online-dot {
  width: 10px;
  height: 10px;
  flex: 0 0 10px;
  border: 2px solid var(--ion-color-medium, #92949c);
  border-radius: 50%;
}

.online-dot.online {
  border-color: var(--ion-color-success, #2dd36f);
  background: var(--ion-color-success, #2dd36f);
}

.role-controls {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
}

/* Inline label + select */
.field-group {
  display: flex;
  align-items: center;
  gap: 6px;
}
.field-label {
  font-size: 0.78em;
  color: var(--ion-color-medium-shade);
  min-width: 48px;
  text-align: right;
}
.native-select {
  border: 1px solid var(--ion-color-medium);
  border-radius: 4px;
  padding: 2px 22px 2px 6px;
  font-size: 0.85em;
  background-color: var(--ion-background-color, #f8f8f2);
  color: var(--ion-color-dark, #222);
  -webkit-appearance: none;
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%23666'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 5px center;
  cursor: pointer;
  min-width: 85px;
  max-width: 130px;
  line-height: 1.4;
}
.native-select:focus {
  outline: none;
  border-color: var(--ion-color-primary);
}

/* Approval controls (pending users) */
.controls-row {
  display: flex;
  gap: 8px;
  margin-top: 6px;
  flex-wrap: wrap;
  align-items: center;
}
.admin-checkbox { font-size: 0.85em; }

.revier-assignment {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
}

.assigned-reviere,
.inline-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.revier-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.revier-chip {
  min-height: 28px;
  padding: 4px 10px;
  border: 1px solid var(--ion-color-medium, #92949c);
  border-radius: 999px;
  background: transparent;
  color: var(--ion-color-medium-shade, #73757e);
  font: inherit;
  font-size: 0.78rem;
  cursor: pointer;
}

.revier-chip:hover,
.revier-chip:focus-visible {
  border-color: var(--ion-color-primary, #546f2c);
  outline: none;
}

.revier-chip.selected {
  border-color: var(--ion-color-primary, #546f2c);
  background: var(--ion-color-primary, #546f2c);
  color: var(--ion-color-primary-contrast, #fff);
  font-weight: 700;
}

.action-buttons {
  display: flex;
  flex-direction: column;
  gap: 4px;
  align-self: flex-start;
}

@media (max-width: 900px) {
  .user-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .user-grid-header {
    display: none;
  }

  .user-info::before,
  .role-controls::before,
  .revier-assignment::before,
  .action-buttons::before {
    display: block;
    width: 100%;
    margin: -10px -10px 10px;
    padding: 8px 10px;
    border-bottom: 1px solid var(--ion-color-light-shade, #dfe6dd);
    background: rgba(84, 111, 44, 0.1);
    color: var(--ion-color-medium-shade, #5f6368);
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
  }

  .user-info,
  .role-controls,
  .revier-assignment,
  .action-buttons {
    min-width: 0;
    padding: 10px;
    border: 1px solid var(--ion-color-light-shade, #dfe6dd);
    border-radius: 6px;
    background: rgba(152, 162, 179, 0.05);
    overflow: hidden;
  }

  .user-info::before { content: 'Anwender'; }
  .role-controls::before { content: 'Rolle und Rechte'; }
  .revier-assignment::before { content: 'Reviere'; }
  .action-buttons::before { content: 'Aktionen'; }
}

@media (max-width: 560px) {
  .map-container {
    height: 220px;
  }

  .modal-map {
    height: min(360px, 40vh);
  }

  .user-grid {
    grid-template-columns: 1fr;
    gap: 16px;
  }

  .action-buttons {
    flex-direction: row;
    flex-wrap: wrap;
  }

  .revier-heading {
    align-items: flex-start;
  }
}
</style>

import { Capacitor } from '@capacitor/core'
import { Geolocation } from '@capacitor/geolocation'

export interface DeviceLocation {
  lat: number
  lng: number
}

/** Gets the current device location, requesting Android location permission when running natively. */
export async function getDeviceLocation(options: PositionOptions = {}): Promise<DeviceLocation> {
  if (Capacitor.isNativePlatform()) {
    const permissions = await Geolocation.checkPermissions()
    if (permissions.location !== 'granted') {
      const requestedPermissions = await Geolocation.requestPermissions({ permissions: ['location'] })
      if (requestedPermissions.location !== 'granted') throw new Error('Standortfreigabe wurde nicht erteilt.')
    }
    const position = await Geolocation.getCurrentPosition(options)
    return { lat: position.coords.latitude, lng: position.coords.longitude }
  }

  if (!navigator.geolocation) throw new Error('GPS wird von diesem Gerät/Browser nicht unterstützt.')
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({ lat: position.coords.latitude, lng: position.coords.longitude }),
      (error) => reject(error),
      options,
    )
  })
}
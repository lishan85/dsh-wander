import { USER_AGENT } from './constants.js'
import type { ExtraPlaceInput, Place, WanderConfig } from './types.js'

/**
 * Public snapshot URLs checked on 2026-10-22.
 * Each returned JPEG bytes (magic ffd8) over HTTPS with no API key.
 * Finland: Fintraffic Digitraffic, CC BY 4.0.
 * Iceland: Vegagerðin, CC BY 4.0.
 * British Columbia: DriveBC, Open Government Licence – British Columbia.
 * Cameras with a third-party credit (for example Parks Canada) are not listed.
 */

const FI_HOSTS = ['weathercam.digitraffic.fi']
const FI_PAGE = 'https://www.digitraffic.fi/en/road-traffic/'
const FI_TOS = 'https://www.digitraffic.fi/en/terms-of-service/'
const FI_ATTR = 'Source: Fintraffic / digitraffic.fi, license CC BY 4.0'
const FI_HEADERS = { 'Digitraffic-User': USER_AGENT }

const IS_HOSTS = ['www.vegagerdin.is']
const IS_PAGE = 'https://www.vegagerdin.is/vegagerdin/gagnasafn/vefthjonustur/vefmyndavelar'
const IS_TOS = 'https://www.vegagerdin.is/vegagerdin/gagnasafn/vefthjonustur/terms-and-conditions'
const IS_ATTR = 'Source: Vegagerðin / Icelandic Road and Coastal Administration, license CC BY 4.0'

const BC_HOSTS = ['www.drivebc.ca']
const BC_PAGE = 'https://www.drivebc.ca/'
const BC_TOS = 'https://www2.gov.bc.ca/gov/content/data/open-data/open-government-licence-bc'
const BC_ATTR = 'Source: DriveBC / Province of British Columbia, Open Government Licence – British Columbia'

function finland(
  id: string,
  name: string,
  region: string,
  preset: string,
  latitude: number,
  longitude: number,
): Place {
  return {
    id,
    name,
    region,
    country: 'Finland',
    timezone: 'Europe/Helsinki',
    latitude,
    longitude,
    snapshotUrl: `https://weathercam.digitraffic.fi/${preset}.jpg`,
    pageUrl: FI_PAGE,
    attribution: FI_ATTR,
    license: 'CC BY 4.0',
    tosUrl: FI_TOS,
    allowedHosts: FI_HOSTS,
    source: 'catalog',
    headers: FI_HEADERS,
  }
}

function iceland(
  id: string,
  name: string,
  region: string,
  file: string,
  latitude: number,
  longitude: number,
): Place {
  return {
    id,
    name,
    region,
    country: 'Iceland',
    timezone: 'Atlantic/Reykjavik',
    latitude,
    longitude,
    snapshotUrl: `https://www.vegagerdin.is/vgdata/vefmyndavelar/${file}`,
    pageUrl: IS_PAGE,
    attribution: IS_ATTR,
    license: 'CC BY 4.0',
    tosUrl: IS_TOS,
    allowedHosts: IS_HOSTS,
    source: 'catalog',
  }
}

function drivebc(
  id: string,
  name: string,
  region: string,
  cameraId: number,
  latitude: number,
  longitude: number,
): Place {
  return {
    id,
    name,
    region,
    country: 'Canada',
    timezone: 'America/Vancouver',
    latitude,
    longitude,
    snapshotUrl: `https://www.drivebc.ca/images/${cameraId}.jpg`,
    pageUrl: BC_PAGE,
    attribution: BC_ATTR,
    license: 'Open Government Licence – British Columbia',
    tosUrl: BC_TOS,
    allowedHosts: BC_HOSTS,
    source: 'catalog',
  }
}

export const CATALOG: readonly Place[] = [
  finland('hanko', 'Hanko', 'Uusimaa', 'C0150701', 59.856454, 23.021452),
  finland('helsinki-ruoholahti', 'Helsinki Ruoholahti', 'Uusimaa', 'C0167400', 60.16591, 24.910959),
  finland('rovaniemi', 'Rovaniemi Revontuli', 'Lapland', 'C1455101', 66.503858, 25.725196),
  finland('kilpisjarvi', 'Kilpisjärvi', 'Lapland', 'C1453501', 69.016677, 20.874249),
  finland('inari', 'Inari Uruvaara', 'Lapland', 'C1454101', 68.900245, 27.077311),
  finland('vaasa', 'Vaasa Kotiranta', 'Ostrobothnia', 'C1052301', 63.102269, 21.641771),
  iceland('reykjanes', 'Reykjanesviti', 'Reykjanes', 'reykjanesviti_1.jpg', 63.816, -22.704),
  iceland('kleifarvatn', 'Kleifarvatn', 'Reykjanes', 'kleifarvatn_1.jpg', 63.919, -22.016),
  iceland('olafsvik', 'Búlandshöfði', 'Snæfellsnes', 'bulandshofdi_1.jpg', 64.942, -23.498),
  iceland('gautavik', 'Gautavík', 'Berufjörður', 'gautavik_1.jpg', 64.737, -14.345),
  iceland('myvatn', 'Mývatnsöræfi', 'Mývatn', 'myvatnsoraefi_1.jpg', 65.658, -16.48),
  drivebc('furry-creek', 'Furry Creek', 'Highway 99', 180, 49.593611, -123.217889),
  drivebc('tofino', 'Ucluelet–Tofino Highway', 'Vancouver Island', 1084, 48.991853, -125.587997),
  drivebc('revelstoke', 'One-Mile Hill', 'Revelstoke', 668, 50.991627, -118.262827),
  drivebc('whistler-bayshore', 'Bayshore Drive', 'Whistler', 1018, 50.089823, -122.99916),
]

export function extraToPlace(input: ExtraPlaceInput): Place {
  const host = new URL(input.snapshotUrl).hostname.toLowerCase()
  return {
    ...input,
    allowedHosts: [host],
    source: 'extra',
  }
}

export function resolvePlaces(config: Pick<WanderConfig, 'enabledPlaceIds' | 'disabledPlaceIds' | 'extraPlaces'>): Place[] {
  const extras = config.extraPlaces.map(extraToPlace)
  let places = [...CATALOG, ...extras]
  if (config.enabledPlaceIds.length > 0) {
    const allow = new Set(config.enabledPlaceIds)
    places = places.filter((place) => allow.has(place.id))
  }
  if (config.disabledPlaceIds.length > 0) {
    const deny = new Set(config.disabledPlaceIds)
    places = places.filter((place) => !deny.has(place.id))
  }
  return places
}

export function findPlace(places: readonly Place[], id: string): Place | undefined {
  return places.find((place) => place.id === id) ?? places.find((place) => place.id === id.toLowerCase())
}

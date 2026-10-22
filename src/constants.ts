/** Identifies this plugin on public camera APIs that ask for a client name. */
export const USER_AGENT = 'dsh-wander/0.1 (https://github.com/lishan85/dsh-wander)'

export const PACKAGE_NAME = 'dsh-wander'

/** setTimeout delay ceiling (2^31 - 1). */
export const MAX_TIMER_DELAY_MS = 2_147_483_647

export const WINDY_IMAGE_HOSTS = [
  'images-webcams.windy.com',
  'imgproxy.windy.com',
  'www.windy.com',
  'api.windy.com',
  'webcams.windy.com',
] as const

export const WINDY_API_URL = 'https://api.windy.com/webcams/api/v3/webcams'

export const WINDY_TOS_URL = 'https://api.windy.com/webcams/docs'

/** Minimum JPEG/PNG/GIF/WebP payload we will treat as a real frame. */
export const MIN_IMAGE_BYTES = 256

export const DEFAULT_MAX_IMAGE_BYTES = 8_000_000

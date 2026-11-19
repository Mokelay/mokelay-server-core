import { mokelayError } from './mokelay-error.js'

/** An asset application is a directory name, never a filesystem path. */
export function assertAssetApp(value: unknown = 'mokelay'): string {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9_-]{0,63}$/.test(value) || value === 'mokelay-schema') {
    throw mokelayError('ASSET_APP_INVALID', '资产应用标识无效。', 400)
  }
  return value
}

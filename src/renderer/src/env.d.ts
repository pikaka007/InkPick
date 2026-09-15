/// <reference types="vite/client" />
import type { InkPickApi } from '@core/api'

declare global {
  interface Window {
    api: InkPickApi
  }
}

export {}

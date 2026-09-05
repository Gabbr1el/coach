import type { CoachDesktopApi } from '../shared/contracts/application-contract'

declare global {
  interface Window {
    coach: CoachDesktopApi
  }
}

export {}

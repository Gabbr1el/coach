import type { ExerciseSet } from '../../shared/contracts/exercise-contract'

const LOAD_RETRY_COOLDOWN_MS = 5 * 60_000

export class ExerciseSetLoadGate {
  private readonly attempts = new Map<string, number>()
  canEnsure(key: string, now = Date.now()): boolean { return (this.attempts.get(key) ?? 0) <= now }
  record(key: string, set: ExerciseSet | null, now = Date.now()): void {
    const retryAfter = set?.retryAfter ?? (set?.status === 'ready' ? 0 : now + LOAD_RETRY_COOLDOWN_MS)
    if (retryAfter > now) this.attempts.set(key, retryAfter)
    else this.attempts.delete(key)
  }
  recordFailure(key: string, now = Date.now()): void { this.attempts.set(key, now + LOAD_RETRY_COOLDOWN_MS) }
}

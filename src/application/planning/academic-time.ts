import type { AcademicEventPhase } from '../../shared/contracts/planning-contract'

const DAY = 86_400_000
function dayStart(value: number): number { const date = new Date(value); date.setHours(0, 0, 0, 0); return date.getTime() }
export function academicEventPhase(dueAt: number, now: number): AcademicEventPhase { const days = Math.round((dayStart(dueAt) - dayStart(now)) / DAY); if (days < 0) return 'passed'; if (days === 0) return 'today'; if (days <= 3) return 'near'; return 'upcoming' }
export function academicDayKey(now: number): string { const date = new Date(now); return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}` }

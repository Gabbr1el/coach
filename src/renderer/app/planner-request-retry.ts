export interface PlannerRetryIdentity {
  readonly content: string
  readonly requestId: string
}

export function plannerRequestIdentity(current: PlannerRetryIdentity | null, content: string, createId: () => string): PlannerRetryIdentity {
  return current?.content === content ? current : { content, requestId: createId() }
}

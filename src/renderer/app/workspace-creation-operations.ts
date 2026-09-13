export const WORKSPACE_CREATE_FALLBACK = 'Não foi possível criar o Workspace. Revise os dados e tente novamente.'
export const MATERIAL_FALLBACK = 'Não foi possível concluir a operação do material. Tente novamente.'

export function publicCreationError(error: unknown, fallback = WORKSPACE_CREATE_FALLBACK): string {
  const message = error instanceof Error ? error.message : String(error)
  const duplicate = message.match(/WORKSPACE_DUPLICATE\|([^|]+)\|([^\r\n]+)$/)
  if (duplicate) return `WORKSPACE_DUPLICATE|${duplicate[1]}|${duplicate[2]}`
  const allowed = [
    'Workspace draft not found',
    'Workspace draft changed after materials were attached; discard it and analyze again',
    'Não foi possível importar o material. Verifique se o PDF ou PPTX é válido e tente novamente.',
    'Workspace não encontrado.',
  ]
  return allowed.find((value) => message.includes(value)) ?? fallback
}

export class WorkspaceCreationOperations {
  private generation = 0
  private queue = Promise.resolve()
  private closed = false
  private submitting = false

  run<T>(operation: (generation: number) => Promise<T>): Promise<T | undefined> {
    const generation = this.generation
    const result = this.queue.then(() => this.closed || generation !== this.generation ? undefined : operation(generation))
    this.queue = result.then(() => undefined, () => undefined)
    return result
  }

  invalidate(operation: () => Promise<void>): Promise<void> {
    this.generation += 1
    return this.enqueue(operation)
  }

  close(operation: () => Promise<void>): Promise<void> {
    this.closed = true
    this.generation += 1
    return this.enqueue(operation)
  }

  submit<T>(operation: () => Promise<T>): Promise<T | undefined> {
    if (this.closed || this.submitting) return Promise.resolve(undefined)
    this.submitting = true
    return this.run(async () => operation()).finally(() => { this.submitting = false })
  }

  isCurrent(generation: number): boolean { return !this.closed && generation === this.generation }
  reopen(): void { this.closed = false; this.submitting = false; this.generation += 1 }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const result = this.queue.then(operation)
    this.queue = result.then(() => undefined, () => undefined)
    return result
  }
}

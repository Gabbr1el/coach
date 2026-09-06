import { describe, expect, it } from 'vitest'
import { runPython } from '../../src/main/code-execution/python-runner'

describe('runPython', () => {
  it('runs Python in isolated mode and captures output', async () => {
    const result = await runPython('print("Coach")')
    expect(result).toMatchObject({ stdout: 'Coach\n', stderr: '', exitCode: 0, timedOut: false })
  })

  it('returns a stable signature for equivalent execution errors', async () => {
    const first = await runPython('raise ValueError("erro")')
    const second = await runPython('\nraise ValueError("erro")')
    expect(first.exitCode).not.toBe(0)
    expect(first.errorSignature).toBe(second.errorSignature)
  })

  it('stops programs that exceed the execution deadline', async () => {
    const result = await runPython('while True: pass')
    expect(result.timedOut || result.exitCode !== 0).toBe(true)
  }, 10_000)
})

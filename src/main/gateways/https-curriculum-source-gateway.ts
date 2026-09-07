import type { CurriculumSourceGateway } from '../../application/roadmaps/curriculum-source-service'
import type { CurriculumSource } from '../../shared/contracts/roadmap-contract'

const allowedHosts = new Set(['docs.python.org', 'docs.oracle.com', 'openjfx.io', 'developer.mozilla.org', 'en.cppreference.com', 'www.gnu.org', 'roadmap.sh'])
const MAX_BYTES = 250_000
const MAX_REDIRECTS = 2

function usefulText(html: string): string { return html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim().slice(0, 12_000) }

export class HttpsCurriculumSourceGateway implements CurriculumSourceGateway {
  constructor(private readonly fetcher: typeof fetch = fetch, private readonly now = Date.now) {}
  async retrieve(source: CurriculumSource): Promise<CurriculumSource> {
    let url = new URL(source.url); const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 5_000)
    try {
    for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
      if (url.protocol !== 'https:' || !allowedHosts.has(url.hostname)) throw new Error('CURRICULUM_SOURCE_NOT_ALLOWED')
      const response = await this.fetcher(url, { redirect: 'manual', signal: controller.signal, headers: { accept: 'text/html,text/plain' } })
      if (response.status >= 300 && response.status < 400) { const location = response.headers.get('location'); if (!location || redirect === MAX_REDIRECTS) throw new Error('CURRICULUM_SOURCE_REDIRECT'); url = new URL(location, url); continue }
      if (!response.ok) throw new Error('CURRICULUM_SOURCE_HTTP')
      const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
      if (!contentType.includes('text/html') && !contentType.includes('text/plain')) throw new Error('CURRICULUM_SOURCE_TYPE')
      const declared = Number(response.headers.get('content-length') ?? 0); if (declared > MAX_BYTES) throw new Error('CURRICULUM_SOURCE_TOO_LARGE')
      if (!response.body) throw new Error('CURRICULUM_SOURCE_HTTP')
      const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let total = 0
      for (;;) { const chunk = await reader.read(); if (chunk.done) break; total += chunk.value.byteLength; if (total > MAX_BYTES) { await reader.cancel(); throw new Error('CURRICULUM_SOURCE_TOO_LARGE') } chunks.push(chunk.value) }
      const bytes = new Uint8Array(total); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
      return { ...source, url: url.toString(), retrieved: true, retrievedAt: this.now(), excerpt: usefulText(new TextDecoder().decode(bytes)) }
    }
    throw new Error('CURRICULUM_SOURCE_REDIRECT')
    } finally { clearTimeout(timeout) }
  }
}

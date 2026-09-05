import { useEffect, useState } from 'react'
import { ArrowRight, BookOpen, Brain, CalendarDays, Plus } from 'lucide-react'
import type { ApplicationInfo } from '../../shared/contracts/application-contract'

export function App() {
  const [applicationInfo, setApplicationInfo] = useState<ApplicationInfo | null>(null)
  const [connectionFailed, setConnectionFailed] = useState(false)

  useEffect(() => {
    void window.coach.application.getInfo()
      .then(setApplicationInfo)
      .catch(() => setConnectionFailed(true))
  }, [])

  return (
    <main className="min-h-screen px-6 py-8 text-coach-ink md:px-10 lg:px-16">
      <header className="mx-auto flex max-w-7xl items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="grid size-11 place-items-center rounded-2xl rounded-bl-md bg-coach-ink font-display text-sm font-black text-white">
            CO
          </div>
          <div>
            <p className="font-display text-lg font-extrabold leading-none">Coach</p>
            <p className="mt-1 text-xs text-coach-muted">Seu sistema de estudos</p>
          </div>
        </div>
        <button className="rounded-full border border-coach-line bg-white/60 px-4 py-2 text-sm font-bold transition hover:-translate-y-0.5 hover:bg-white">
          Configurações
        </button>
      </header>

      <section className="mx-auto mt-20 max-w-7xl">
        <div className="max-w-3xl">
          <p className="mb-3 text-xs font-black uppercase tracking-[0.22em] text-coach-green">Visão acadêmica</p>
          <h1 className="font-display text-5xl font-black leading-[0.95] tracking-tight md:text-7xl">
            O que merece sua
            <span className="block text-coach-orange">atenção agora?</span>
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-coach-muted">
            Seus ambientes de estudo aparecerão aqui. O Coach organizará prioridades usando prazos, domínio, dificuldade e disponibilidade — não apenas datas.
          </p>
        </div>

        <div className="mt-12 grid gap-5 lg:grid-cols-[1.35fr_0.65fr]">
          <section className="group relative overflow-hidden rounded-[2rem] border border-coach-line bg-white/70 p-8 shadow-soft backdrop-blur-xl">
            <div className="absolute -right-16 -top-16 size-52 rounded-full bg-coach-yellow/25 blur-2xl" />
            <div className="relative">
              <div className="grid size-12 place-items-center rounded-2xl bg-coach-green/10 text-coach-green">
                <BookOpen size={23} strokeWidth={2.2} />
              </div>
              <h2 className="mt-7 font-display text-3xl font-extrabold">Ainda não há Workspaces</h2>
              <p className="mt-3 max-w-xl leading-7 text-coach-muted">
                Na próxima etapa, você poderá criar um Workspace, definir seu objetivo e reencontrá-lo mesmo depois de fechar o aplicativo.
              </p>
              <button disabled className="mt-8 inline-flex items-center gap-3 rounded-xl bg-coach-orange px-5 py-3 font-extrabold text-white opacity-55">
                <Plus size={18} /> Criar primeiro Workspace
              </button>
            </div>
          </section>

          <aside className="rounded-[2rem] bg-coach-ink p-7 text-white shadow-soft">
            <div className="flex items-center justify-between">
              <span className="text-xs font-black uppercase tracking-[0.18em] text-coach-yellow">Fundação</span>
              <Brain className="text-coach-yellow" size={23} />
            </div>
            <p className="mt-8 font-display text-2xl font-extrabold leading-tight">O sistema aprende o processo, não só a resposta.</p>
            <ul className="mt-7 space-y-4 text-sm text-white/65">
              <li className="flex gap-3"><CalendarDays className="shrink-0 text-coach-mint" size={18} /> Planejamento baseado na vida real</li>
              <li className="flex gap-3"><ArrowRight className="shrink-0 text-coach-mint" size={18} /> Ajuda progressiva e contextual</li>
              <li className="flex gap-3"><BookOpen className="shrink-0 text-coach-mint" size={18} /> Memória pertencente ao estudante</li>
            </ul>
          </aside>
        </div>
      </section>

      <footer className="mx-auto mt-20 flex max-w-7xl justify-between border-t border-coach-line py-5 text-xs text-coach-muted">
        <span>Dados locais por padrão</span>
        <span>{applicationInfo ? `${applicationInfo.name} ${applicationInfo.version} · API ${applicationInfo.apiVersion}` : connectionFailed ? 'Integração desktop indisponível' : 'Conectando ao aplicativo…'}</span>
      </footer>
    </main>
  )
}

import { and, desc, eq, ne } from 'drizzle-orm'
import type { ProviderConfiguration, ProviderConfigurationRepository } from '../../application/ai/provider-configuration-repository'
import type { CoachDatabase } from '../database/connection'
import { providerConfigurations } from '../database/schema/provider-configurations'

export class DrizzleProviderConfigurationRepository implements ProviderConfigurationRepository {
  constructor(private readonly database: CoachDatabase) {}

  async getActive(): Promise<ProviderConfiguration | null> {
    return this.database.orm.select().from(providerConfigurations).where(eq(providerConfigurations.isActive, true)).get() ?? null
  }

  async findById(id: string): Promise<ProviderConfiguration | null> {
    return this.database.orm.select().from(providerConfigurations).where(eq(providerConfigurations.id, id)).get() ?? null
  }

  async list(): Promise<ProviderConfiguration[]> {
    return this.database.orm.select().from(providerConfigurations).orderBy(desc(providerConfigurations.updatedAt), desc(providerConfigurations.createdAt), desc(providerConfigurations.id)).all()
  }

  async createAndActivate(configuration: ProviderConfiguration): Promise<void> {
    this.database.sqlite.transaction(() => {
      this.database.orm.update(providerConfigurations).set({ isActive: false }).where(eq(providerConfigurations.isActive, true)).run()
      this.database.orm.insert(providerConfigurations).values(configuration).run()
    })()
  }

  async activate(id: string, updatedAt: number): Promise<void> {
    this.database.sqlite.transaction(() => {
      this.database.orm.update(providerConfigurations).set({ isActive: false }).where(and(eq(providerConfigurations.isActive, true), ne(providerConfigurations.id, id))).run()
      const selected = this.database.orm.update(providerConfigurations).set({ isActive: true, updatedAt }).where(eq(providerConfigurations.id, id)).returning({ id: providerConfigurations.id }).get()
      if (!selected) throw new Error('Provider account not found')
    })()
  }

  async remove(id: string): Promise<ProviderConfiguration | null> {
    return this.database.orm.delete(providerConfigurations).where(eq(providerConfigurations.id, id)).returning().get() ?? null
  }
}

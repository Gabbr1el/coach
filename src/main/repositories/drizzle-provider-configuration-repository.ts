import { eq } from 'drizzle-orm'
import type { ProviderConfiguration, ProviderConfigurationRepository } from '../../application/ai/provider-configuration-repository'
import type { CoachDatabase } from '../database/connection'
import { providerConfigurations } from '../database/schema/provider-configurations'

export class DrizzleProviderConfigurationRepository implements ProviderConfigurationRepository {
  constructor(private readonly database: CoachDatabase) {}

  async getActive(): Promise<ProviderConfiguration | null> {
    return this.database.orm.select().from(providerConfigurations).where(eq(providerConfigurations.isActive, true)).get() ?? null
  }

  async upsert(configuration: ProviderConfiguration): Promise<void> {
    this.database.orm.insert(providerConfigurations).values(configuration).onConflictDoUpdate({
      target: providerConfigurations.providerId,
      set: {
        displayName: configuration.displayName,
        model: configuration.model,
        secretReference: configuration.secretReference,
        isActive: true,
        updatedAt: configuration.updatedAt,
      },
    }).run()
  }

  async disconnect(providerId: 'openai', updatedAt: number): Promise<void> {
    this.database.orm.update(providerConfigurations).set({ isActive: false, updatedAt }).where(eq(providerConfigurations.providerId, providerId)).run()
  }
}

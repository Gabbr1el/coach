import {
  and,
  desc,
  eq,
  ne,
} from 'drizzle-orm'

import type {
  ProviderConfiguration,
  ProviderConfigurationRepository,
  UpdateProviderConfigurationInput,
} from '../../application/ai/provider-configuration-repository'

import type {
  CoachDatabase,
} from '../database/connection'

import {
  providerConfigurations,
} from '../database/schema/provider-configurations'

export class DrizzleProviderConfigurationRepository
implements ProviderConfigurationRepository {
  constructor(
    private readonly database:
      CoachDatabase,
  ) {}

  async getActive():
    Promise<ProviderConfiguration | null> {
    return (
      this.database.orm
        .select()
        .from(providerConfigurations)
        .where(
          eq(
            providerConfigurations.isActive,
            true,
          ),
        )
        .get()
      ?? null
    )
  }

  async findById(
    id: string,
  ): Promise<ProviderConfiguration | null> {
    return (
      this.database.orm
        .select()
        .from(providerConfigurations)
        .where(
          eq(
            providerConfigurations.id,
            id,
          ),
        )
        .get()
      ?? null
    )
  }

  async findByIdentity(
    providerId: ProviderConfiguration['providerId'],
    identityKey: string,
  ): Promise<ProviderConfiguration | null> {
    return (
      this.database.orm
        .select()
        .from(providerConfigurations)
        .where(
          and(
            eq(providerConfigurations.providerId, providerId),
            eq(providerConfigurations.identityKey, identityKey),
          ),
        )
        .get()
      ?? null
    )
  }

  async list():
    Promise<ProviderConfiguration[]> {
    return this.database.orm
      .select()
      .from(providerConfigurations)
      .orderBy(
        desc(
          providerConfigurations.updatedAt,
        ),
        desc(
          providerConfigurations.createdAt,
        ),
        desc(
          providerConfigurations.id,
        ),
      )
      .all()
  }

  async createAndActivate(
    configuration: ProviderConfiguration,
  ): Promise<void> {
    this.database.sqlite.transaction(
      () => {
        this.database.orm
          .update(
            providerConfigurations,
          )
          .set({
            isActive: false,
          })
          .where(
            eq(
              providerConfigurations.isActive,
              true,
            ),
          )
          .run()

        this.database.orm
          .insert(
            providerConfigurations,
          )
          .values(
            configuration,
          )
          .run()
      },
    )()
  }

  async activate(
    id: string,
    updatedAt: number,
  ): Promise<void> {
    this.database.sqlite.transaction(
      () => {
        this.database.orm
          .update(
            providerConfigurations,
          )
          .set({
            isActive: false,
          })
          .where(
            and(
              eq(
                providerConfigurations.isActive,
                true,
              ),
              ne(
                providerConfigurations.id,
                id,
              ),
            ),
          )
          .run()

        const selected =
          this.database.orm
            .update(
              providerConfigurations,
            )
            .set({
              isActive: true,
              isEnabled: true,
              updatedAt,
            })
            .where(
              eq(
                providerConfigurations.id,
                id,
              ),
            )
            .returning({
              id:
                providerConfigurations.id,
            })
            .get()

        if (!selected) {
          throw new Error(
            'Provider account not found',
          )
        }
      },
    )()
  }

  async setEnabled(
    id: string,
    enabled: boolean,
    updatedAt: number,
  ): Promise<ProviderConfiguration | null> {
    return (
      this.database.orm
        .update(
          providerConfigurations,
        )
        .set({
          isEnabled: enabled,
          isActive: enabled
            ? providerConfigurations.isActive
            : false,
          updatedAt,
        })
        .where(
          eq(
            providerConfigurations.id,
            id,
          ),
        )
        .returning()
        .get()
      ?? null
    )
  }

  async update(
    id: string,
    input: UpdateProviderConfigurationInput,
  ): Promise<ProviderConfiguration | null> {
    return (
      this.database.orm
        .update(
          providerConfigurations,
        )
        .set({
          ...(input.label !== undefined
            ? {
                label:
                  input.label,
              }
            : {}),

          ...(input.model !== undefined
            ? {
                model:
                  input.model,
              }
            : {}),

          ...(input.reasoningEffort !== undefined
            ? {
                reasoningEffort:
                  input.reasoningEffort,
              }
            : {}),

          ...(input.identityLabel !== undefined
            ? {
                identityLabel:
                  input.identityLabel,
              }
            : {}),

          ...(input.baseUrl !== undefined
            ? {
                baseUrl:
                  input.baseUrl,
              }
            : {}),

          updatedAt:
            input.updatedAt,
        })
        .where(
          eq(
            providerConfigurations.id,
            id,
          ),
        )
        .returning()
        .get()
      ?? null
    )
  }

  async remove(
    id: string,
  ): Promise<ProviderConfiguration | null> {
    return (
      this.database.orm
        .delete(
          providerConfigurations,
        )
        .where(
          eq(
            providerConfigurations.id,
            id,
          ),
        )
        .returning()
        .get()
      ?? null
    )
  }


  async updateOAuthIdentity(
    id: string,
    identityKey: string,
    identityLabel: string | null,
    model: string,
    updatedAt: number,
  ): Promise<ProviderConfiguration | null> {
    return (
      this.database.orm
        .update(providerConfigurations)
        .set({
          identityKey,
          identityLabel,
          model,
          updatedAt,
        })
        .where(eq(providerConfigurations.id, id))
        .returning()
        .get()
      ?? null
    )
  }


  async mergeOAuthIdentity(
    targetId: string,
    duplicateId: string,
    identityKey: string,
    identityLabel: string | null,
    model: string,
    updatedAt: number,
  ): Promise<ProviderConfiguration | null> {
    return this.database.sqlite.transaction(
      () => {
        this.database.orm
          .delete(providerConfigurations)
          .where(eq(providerConfigurations.id, duplicateId))
          .run()

        return (
          this.database.orm
            .update(providerConfigurations)
            .set({
              identityKey,
              identityLabel,
              model,
              updatedAt,
            })
            .where(eq(providerConfigurations.id, targetId))
            .returning()
            .get()
          ?? null
        )
      },
    )()
  }
}

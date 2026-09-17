import { sql } from 'drizzle-orm'
import {
  check,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'

import {
  providerAuthKinds,
  providerConnectorIds,
  reasoningEfforts,
} from '../../../shared/contracts/provider-account-contract'

export const providerConfigurations = sqliteTable(
  'provider_configurations',
  {
    id: text('id').primaryKey(),

    /**
     * Identifica o conector da conta.
     *
     * Exemplos:
     * openai
     * gemini
     * anthropic
     * omniroute
     * openai-compatible
     * ollama
     */
    providerId: text('provider_id', {
      enum: providerConnectorIds,
    }).notNull(),

    /**
     * Nome oficial/visual do provider.
     *
     * Exemplos:
     * OpenAI
     * Gemini
     * OmniRoute
     */
    displayName: text('display_name').notNull(),

    /**
     * Nome escolhido pelo usuário para distinguir suas contas.
     *
     * Exemplos:
     * "Gemini pessoal"
     * "Gemini faculdade"
     */
    label: text('label').notNull(),

    /**
     * Método de autenticação/conexão utilizado pela conta.
     *
     * Contas já existentes serão tratadas pela migration.
     */
    authKind: text('auth_kind', {
      enum: providerAuthKinds,
    })
      .notNull()
      .default('api-key'),

    /**
     * Identidade pública da conta.
     *
     * Exemplo:
     * usuario@gmail.com
     *
     * Nunca deve armazenar tokens ou segredos.
     */
    identityLabel: text('identity_label'),

    /**
     * Endpoint configurável somente para conectores que precisam dele.
     */
    baseUrl: text('base_url'),

    /**
     * Modelo escolhido para esta conta.
     */
    model: text('model').notNull(),

    /**
     * Esforço de raciocínio desejado.
     *
     * O adapter do provider decidirá posteriormente como traduzir isso
     * para cada API/modelo.
     */
    reasoningEffort: text('reasoning_effort', {
      enum: reasoningEfforts,
    })
      .notNull()
      .default('auto'),

    /**
     * Referência para o CredentialVault.
     *
     * Continua obrigatória nesta etapa para preservar integralmente
     * o comportamento atual.
     *
     * OAuth também poderá utilizar esta referência para refresh tokens.
     *
     * Quando implementarmos Ollama/local vamos decidir explicitamente
     * como tratar conectores que não possuem segredo.
     */
    secretReference: text('secret_reference').notNull(),

    /**
     * Determina se o Coach tem permissão para utilizar esta conta.
     *
     * Desabilitar NÃO remove credenciais.
     */
    isEnabled: integer('is_enabled', {
      mode: 'boolean',
    })
      .notNull()
      .default(true),

    /**
     * Conta principal atual.
     *
     * Continua existindo apenas uma conta principal.
     */
    isActive: integer('is_active', {
      mode: 'boolean',
    })
      .notNull()
      .default(false),

    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    check(
      'provider_configurations_provider_check',
      sql`${table.providerId} in (
        'openai',
        'gemini',
        'anthropic',
        'omniroute',
        'openai-compatible',
        'ollama'
      )`,
    ),

    check(
      'provider_configurations_auth_kind_check',
      sql`${table.authKind} in (
        'api-key',
        'oauth',
        'endpoint-token',
        'local'
      )`,
    ),

    check(
      'provider_configurations_reasoning_effort_check',
      sql`${table.reasoningEffort} in (
        'auto',
        'low',
        'medium',
        'high'
      )`,
    ),

    check(
      'provider_configurations_secret_reference_check',
      sql`length(trim(${table.secretReference})) > 0`,
    ),

    check(
      'provider_configurations_label_check',
      sql`length(trim(${table.label})) between 1 and 60`,
    ),

    check(
      'provider_configurations_identity_label_check',
      sql`${table.identityLabel} is null or length(trim(${table.identityLabel})) between 1 and 120`,
    ),

    /**
     * Providers oficiais possuem endpoint conhecido pelo adapter.
     *
     * Conectores configuráveis/local precisam de endpoint.
     */
    check(
      'provider_configurations_base_url_check',
      sql`
        (
          ${table.providerId} in ('openai', 'gemini', 'anthropic')
          and ${table.baseUrl} is null
        )
        or
        (
          ${table.providerId} in ('openai-compatible', 'omniroute', 'ollama')
          and ${table.baseUrl} is not null
          and length(trim(${table.baseUrl})) > 0
        )
      `,
    ),

    /**
     * Uma conta desativada nunca pode continuar marcada como principal.
     */
    check(
      'provider_configurations_active_enabled_check',
      sql`${table.isActive} = 0 or ${table.isEnabled} = 1`,
    ),

    /**
     * Ainda existe somente uma conta principal global.
     *
     * Ter várias contas conectadas NÃO significa utilizar todas ao mesmo
     * tempo. Roteamento por função será tratado depois.
     */
    uniqueIndex('provider_configurations_single_active_idx')
      .on(table.isActive)
      .where(sql`${table.isActive} = 1`),
  ],
)
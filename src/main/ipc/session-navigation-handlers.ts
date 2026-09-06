import { ipcMain } from 'electron'
import type { CoachDatabase } from '../database/connection'
import { SESSION_NAVIGATION_CHANNELS } from '../../shared/contracts/session-navigation-channels'
import { addSavedForLaterSchema } from '../../shared/contracts/session-navigation-contract'
import { workspaceConversationInputSchema } from '../../shared/contracts/conversation-contract'
import { assertTrustedSender } from './trusted-sender'

export function registerSessionNavigationHandlers(database: CoachDatabase): void {
  ipcMain.handle(SESSION_NAVIGATION_CHANNELS.addSavedForLater, (event, payload) => { assertTrustedSender(event); const input = addSavedForLaterSchema.parse(payload); const item = { id: crypto.randomUUID(), content: input.content, completedAt: null, createdAt: Date.now() }; database.sqlite.prepare('INSERT INTO saved_for_later (id, workspace_id, content, created_at) VALUES (?, ?, ?, ?)').run(item.id, input.workspaceId, item.content, item.createdAt); return item })
  ipcMain.handle(SESSION_NAVIGATION_CHANNELS.listSavedForLater, (event, payload) => { assertTrustedSender(event); const { workspaceId } = workspaceConversationInputSchema.parse(payload); return database.sqlite.prepare('SELECT id, content, completed_at AS completedAt, created_at AS createdAt FROM saved_for_later WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 100').all(workspaceId) })
  ipcMain.handle(SESSION_NAVIGATION_CHANNELS.listOutline, (event, payload) => { assertTrustedSender(event); const { workspaceId } = workspaceConversationInputSchema.parse(payload); return database.sqlite.prepare(`SELECT e.id, CASE e.type WHEN 'execution_error' THEN 'Erro de execução' WHEN 'possible_learning_loop' THEN 'Loop de aprendizagem detectado' WHEN 'code_executed' THEN 'Código executado' WHEN 'window_blurred' THEN 'Saída de foco' ELSE e.type END AS title, e.type AS kind, e.created_at AS occurredAt FROM learning_events e JOIN workspace_study_states ws ON ws.active_session_id = e.session_id WHERE ws.workspace_id = ? ORDER BY e.created_at ASC, e.rowid ASC LIMIT 200`).all(workspaceId) })
}

export const CONVERSATION_CHANNELS = {
  listHomeMessages: 'conversation:list-home-messages',
  sendHomeMessage: 'conversation:send-home-message',
  streamHomeMessage: 'conversation:stream-home-message',
  cancelHomeStream: 'conversation:cancel-home-stream',
  homeStreamEvent: 'conversation:home-stream-event',
  listWorkspaceMessages: 'conversation:list-workspace-messages',
  streamWorkspaceMessage: 'conversation:stream-workspace-message',
  cancelWorkspaceStream: 'conversation:cancel-workspace-stream',
  workspaceStreamEvent: 'conversation:workspace-stream-event',
} as const

export const WORKSPACE_CHANNELS = {
  list: 'workspace:list',
  listHistory: 'workspace:list-history',
  getHistoryDetail: 'workspace:get-history-detail',
  create: 'workspace:create',
  prepareDraft: 'workspace:prepare-draft',
  discardDraft: 'workspace:discard-draft',
  getProvisioning: 'workspace:get-provisioning',
  retryProvisioning: 'workspace:retry-provisioning',
  open: 'workspace:open',
  archive: 'workspace:archive',
  acceptContinuation: 'workspace:accept-continuation',
  declineContinuation: 'workspace:decline-continuation',
} as const

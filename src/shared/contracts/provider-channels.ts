export const PROVIDER_CHANNELS = {
  getStatus:
    'provider:get-status',

  listAccounts:
    'provider:list-accounts',

  listAvailableModels:
    'provider:list-available-models',

  refreshHealth:
    'provider:refresh-health',

  checkActiveFunctionalHealth:
    'provider:check-active-functional-health',

  configureOpenAI:
    'provider:configure-openai',

  configureCompatible:
    'provider:configure-compatible',

  beginGitHubCopilotOAuth:
    'provider:begin-github-copilot-oauth',

  completeGitHubCopilotOAuth:
    'provider:complete-github-copilot-oauth',


  selectAccount:
    'provider:select-account',

  setAccountEnabled:
    'provider:set-account-enabled',

  updateAccount:
    'provider:update-account',

  removeAccount:
    'provider:remove-account',
} as const

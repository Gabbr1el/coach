export const PROVIDER_CHANNELS = {
  getStatus:
    'provider:get-status',

  listAccounts:
    'provider:list-accounts',

  configureOpenAI:
    'provider:configure-openai',

  configureCompatible:
    'provider:configure-compatible',

  selectAccount:
    'provider:select-account',

  setAccountEnabled:
    'provider:set-account-enabled',

  updateAccount:
    'provider:update-account',

  removeAccount:
    'provider:remove-account',
} as const
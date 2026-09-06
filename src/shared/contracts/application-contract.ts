export const APPLICATION_API_VERSION = 1 as const
export const APPLICATION_GET_INFO_CHANNEL = 'application:get-info' as const

export type DesktopPlatform = 'aix' | 'android' | 'darwin' | 'freebsd' | 'haiku' | 'linux' | 'openbsd' | 'sunos' | 'win32' | 'cygwin' | 'netbsd'

export interface ApplicationInfo {
  readonly apiVersion: typeof APPLICATION_API_VERSION
  readonly name: string
  readonly version: string
  readonly platform: DesktopPlatform
}

export interface CoachDesktopApi {
  application: {
    getInfo(): Promise<ApplicationInfo>
  }
  workspace: import('./workspace-contract').WorkspaceApi
  conversation: import('./conversation-contract').ConversationApi
  provider: import('./provider-contract').ProviderApi
  studyWorkspace: import('./study-workspace-contract').StudyWorkspaceApi
  codeExecution: import('./code-execution-contract').CodeExecutionApi
  observer: import('./observer-contract').ObserverApi
}

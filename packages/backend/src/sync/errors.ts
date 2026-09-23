export class SyncError extends Error {
  constructor(public readonly code: string, public readonly statusCode: number, public readonly details?: Record<string, unknown>) {
    super(code);
  }
}

export function requireProtocolVersion(version: number): void {
  if (version !== 1) throw new SyncError('sync_protocol_incompatible', 426, { minimumVersion: 1, maximumVersion: 1 });
}

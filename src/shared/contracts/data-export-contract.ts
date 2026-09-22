export interface DataExportApi {
  exportData(): Promise<string | null>
}

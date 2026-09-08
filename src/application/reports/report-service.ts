import type { GlobalReportOverview } from '../../shared/contracts/report-contract'

export interface ReportRepository {
  getGlobalOverview(): GlobalReportOverview
}

export class ReportService {
  constructor(private readonly repository: ReportRepository) {}

  getGlobalOverview(): GlobalReportOverview {
    return this.repository.getGlobalOverview()
  }
}

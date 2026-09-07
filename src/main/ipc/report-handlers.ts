import { ipcMain } from 'electron'
import type { ReportService } from '../../application/reports/report-service'
import { REPORT_CHANNELS } from '../../shared/contracts/report-channels'
import { assertTrustedSender } from './trusted-sender'
export function registerReportHandlers(service: ReportService): void { ipcMain.handle(REPORT_CHANNELS.getGlobalOverview, (event) => { assertTrustedSender(event); return service.getGlobalOverview() }) }

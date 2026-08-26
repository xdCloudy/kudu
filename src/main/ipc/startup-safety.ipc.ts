import { ipcMain } from 'electron'
import { IPC } from '../../shared/channels'
import { localCloud } from '../services/local-cloud-service'

export function registerStartupSafetyIpc(): void {
  ipcMain.handle(IPC.STARTUP_SAFETY_FETCH, async () => {
    return localCloud.getStartupSafetyRatings()
  })
}

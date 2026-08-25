import { ipcMain } from 'electron'
import { IPC } from '../../shared/channels'
import { localCloud } from '../services/local-cloud-service'

export function registerProgramSafetyIpc(): void {
  ipcMain.handle(IPC.PROGRAM_SAFETY_FETCH, async () => {
    return localCloud.getInstalledProgramSafetyRatings()
  })
}

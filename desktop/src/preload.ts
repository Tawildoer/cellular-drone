import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

/**
 * The only native calls the UI gets (ADR-0027): what version it is, being
 * told an update is ready, and reloading into it. The page itself has no
 * Node or file access. Mirrored by web/src/app/desktopBridge.ts.
 */
contextBridge.exposeInMainWorld('droneDesktop', {
  info: () => ipcRenderer.invoke('desktop:info'),
  onUpdateReady: (listener: (update: { version: string }) => void) => {
    const handler = (_event: IpcRendererEvent, update: { version: string }) => listener(update)
    ipcRenderer.on('desktop:update-ready', handler)
    return () => ipcRenderer.off('desktop:update-ready', handler)
  },
  applyUpdate: () => ipcRenderer.invoke('desktop:apply-update'),
})

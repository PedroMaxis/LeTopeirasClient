import { contextBridge, ipcRenderer } from 'electron';
import { IpcChannel, SYSTEM_AUDIO_PORT_MESSAGE, type LeTopeirasApi } from '../shared/ipc';

const api: LeTopeirasApi = {
  getAppInfo: () => ipcRenderer.invoke(IpcChannel.GetAppInfo),
  getScreenSources: () => ipcRenderer.invoke(IpcChannel.GetScreenSources),
  selectScreenSource: (sourceId) => ipcRenderer.invoke(IpcChannel.SelectScreenSource, sourceId),
  minimizeWindow: () => ipcRenderer.invoke(IpcChannel.WindowMinimize),
  toggleMaximizeWindow: () => ipcRenderer.invoke(IpcChannel.WindowToggleMaximize),
  closeWindow: () => ipcRenderer.invoke(IpcChannel.WindowClose),
  showWindow: () => ipcRenderer.invoke(IpcChannel.WindowShow),
  getIdleSeconds: () => ipcRenderer.invoke(IpcChannel.GetIdleSeconds),
  getLaunchAtLogin: () => ipcRenderer.invoke(IpcChannel.GetLaunchAtLogin),
  setLaunchAtLogin: (enabled) => ipcRenderer.invoke(IpcChannel.SetLaunchAtLogin, enabled),
  loadSession: () => ipcRenderer.invoke(IpcChannel.SessionLoad),
  saveSession: (token) => ipcRenderer.invoke(IpcChannel.SessionSave, token),
  clearSession: () => ipcRenderer.invoke(IpcChannel.SessionClear),
  getSystemAudioStatus: () => ipcRenderer.invoke(IpcChannel.SystemAudioStatus),
  startSystemAudio: (sourceId) => ipcRenderer.invoke(IpcChannel.SystemAudioStart, sourceId),
  stopSystemAudio: () => ipcRenderer.invoke(IpcChannel.SystemAudioStop),
};

// The preload is type-checked without DOM types; this is the one window API it uses.
declare const window: {
  postMessage(message: unknown, targetOrigin: string, transfer?: readonly unknown[]): void;
};

// MessagePorts can't cross contextBridge; posting to the page's window is the supported way.
ipcRenderer.on(IpcChannel.SystemAudioPort, (event) => {
  window.postMessage(SYSTEM_AUDIO_PORT_MESSAGE, '*', event.ports);
});

contextBridge.exposeInMainWorld('api', api);

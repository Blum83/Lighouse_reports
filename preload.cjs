const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  startTests: (config) => ipcRenderer.send('start-tests', config),
  stopTests:  () => ipcRenderer.send('stop-tests'),

  onStatus:   (cb) => ipcRenderer.on('status',    (_e, msg)  => cb(msg)),
  onProgress: (cb) => ipcRenderer.on('progress',  (_e, data) => cb(data)),
  onRunDone:  (cb) => ipcRenderer.on('run-done',  (_e, data) => cb(data)),
  onRunError: (cb) => ipcRenderer.on('run-error', (_e, data) => cb(data)),
  onDone:     (cb) => ipcRenderer.on('done',      ()         => cb()),

  removeListeners: () => {
    ['status', 'progress', 'run-done', 'run-error', 'done'].forEach(ch =>
      ipcRenderer.removeAllListeners(ch)
    );
  },
});

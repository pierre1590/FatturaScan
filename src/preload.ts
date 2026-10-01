//oxlint-disable eslint-plugin-unicorn/no-empty-file
// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld("fattureAPI", {
  selezionaPDF: (): Promise<string[]> =>
    ipcRenderer.invoke("fatture:seleziona-pdf"),

  leggiPDF: (percorso: string): Promise<Uint8Array> =>
    ipcRenderer.invoke("fatture:leggi-pdf", percorso),

  salvaExcel: (dati: Uint8Array, nomeFile: string): Promise<string | null> =>
    ipcRenderer.invoke("fatture:salva-excel", dati, nomeFile),

  statoLotto: (daProteggere: boolean): void => {
    ipcRenderer.send("fatture:stato-lotto", daProteggere);
  },
});
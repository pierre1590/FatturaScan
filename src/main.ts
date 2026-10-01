import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  type MenuItemConstructorOptions,
} from 'electron';

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

declare const MAIN_WINDOW_WEBPACK_ENTRY: string;
declare const MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY: string;

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

const pdfSelezionati = new Set<string>();

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    icon: app.isPackaged
      ? path.join(process.resourcesPath, 'fatturascan.ico')
      : path.join(process.cwd(), 'assets', 'fatturascan.ico'),
    width: 1000,
    height: 760,
    webPreferences: {
      preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  void mainWindow.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);
}

function impostaMenuItaliano(): void {
  const modello: MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        { label: 'Esci', role: 'quit' },
      ],
    },
    {
      label: 'Modifica',
      submenu: [
        { label: 'Annulla', role: 'undo' },
        { label: 'Ripristina', role: 'redo' },
        { type: 'separator' },
        { label: 'Taglia', role: 'cut' },
        { label: 'Copia', role: 'copy' },
        { label: 'Incolla', role: 'paste' },
        { type: 'separator' },
        { label: 'Seleziona tutto', role: 'selectAll' },
      ],
    },
    {
      label: 'Aiuto',
      submenu: [
        {
          label: 'Informazioni su FatturaScan',
          click: () => {
            const finestra =
              BrowserWindow.getFocusedWindow() ??
              BrowserWindow.getAllWindows()[0];

            const opzioni = {
              type: 'info' as const,
              title: 'Informazioni su FatturaScan',
              message: app.getName(),
              detail: `Versione ${app.getVersion()}\n` + ` Autore: Piero Sabino`,
              
              buttons: ['Chiudi'],
            };

            if (finestra) {
              void dialog.showMessageBox(finestra, opzioni);
            } else {
              void dialog.showMessageBox(opzioni);
            }
          },
        },
        {
          label: 'Verifica aggiornamenti',
          click: () => {
            const finestra =
              BrowserWindow.getFocusedWindow() ??
              BrowserWindow.getAllWindows()[0];

            const opzioni = {
              type: 'info' as const,
              title: 'Aggiornamenti',
              message: 'Verifica aggiornamenti non ancora configurata',
              detail:
                'Versione installata: ' +
                app.getVersion() +
                '. Per controllare nuovi rilasci occorre configurare ' +
                'una fonte ufficiale di aggiornamento.',
              buttons: ['Chiudi'],
            };

            if (finestra) {
              void dialog.showMessageBox(finestra, opzioni);
            } else {
              void dialog.showMessageBox(opzioni);
            }
          },
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(modello));
}

function richiestaValida(evento: Electron.IpcMainInvokeEvent): boolean {
  const finestra = BrowserWindow.fromWebContents(evento.sender);

  return Boolean(
    finestra &&
    evento.senderFrame === finestra.webContents.mainFrame,
  );
}

ipcMain.handle('fatture:seleziona-pdf', async () => {
  const finestra = BrowserWindow.getFocusedWindow();

  const risultato = finestra
    ? await dialog.showOpenDialog(finestra, {
        title: 'Seleziona le fatture PDF',
        buttonLabel: 'Carica fatture',
        filters: [
          {
            name: 'Documenti PDF',
            extensions: ['pdf'],
          },
        ],
        properties: ['openFile', 'multiSelections'],
      })
    : await dialog.showOpenDialog({
        title: 'Seleziona le fatture PDF',
        buttonLabel: 'Carica fatture',
        filters: [
          {
            name: 'Documenti PDF',
            extensions: ['pdf'],
          },
        ],
        properties: ['openFile', 'multiSelections'],
      });

  if (risultato.canceled) {
    return [];
  }

  for (const percorso of risultato.filePaths) {
    pdfSelezionati.add(path.resolve(percorso));
  }

  return risultato.filePaths;
});

ipcMain.handle(
  'fatture:leggi-pdf',
  async (
    evento,
    percorso: string,
  ): Promise<Uint8Array> => {
    if (!richiestaValida(evento)) {
      throw new Error('Richiesta PDF non autorizzata.');
    }

    if (typeof percorso !== 'string') {
      throw new Error('Percorso PDF non valido.');
    }

    const percorsoNormalizzato = path.resolve(percorso);

    if (!pdfSelezionati.has(percorsoNormalizzato)) {
      throw new Error('Il PDF non è stato selezionato nell’app.');
    }

    return new Uint8Array(
      await readFile(percorsoNormalizzato),
    );
  },
);

ipcMain.handle(
  'fatture:salva-excel',
  async (
    evento,
    dati: Uint8Array | ArrayBuffer,
    nomeFile: string,
  ): Promise<string | null> => {
    const finestra = BrowserWindow.fromWebContents(evento.sender);

    if (
      !finestra ||
      evento.senderFrame !== finestra.webContents.mainFrame
    ) {
      throw new Error('Esportazione non autorizzata.');
    }

  let bytes: Uint8Array;

if (dati instanceof Uint8Array) {
  bytes = dati;
} else if (dati instanceof ArrayBuffer) {
  bytes = new Uint8Array(dati);
} else {
  throw new Error("Dati Excel non validi.");
}

if (bytes.byteLength === 0) {
  throw new Error("Il file Excel generato è vuoto.");
}

    const nomeProposto = String(nomeFile || 'fatture-cliente.xlsx')
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
      .replace(/^\.+/, '');

    const risultato = await dialog.showSaveDialog(finestra, {
      title: 'Salva Excel del cliente',
      defaultPath: nomeProposto || 'fatture-cliente.xlsx',
      buttonLabel: 'Salva',
      filters: [
        {
          name: 'File Excel',
          extensions: ['xlsx'],
        },
      ],
    });

    if (risultato.canceled || !risultato.filePath) {
      return null;
    }

    if (!risultato.filePath.toLowerCase().endsWith('.xlsx')) {
      throw new Error('Il file deve avere estensione .xlsx.');
    }

    try {
      await writeFile(
        risultato.filePath,
        Buffer.from(bytes),
        { flag: 'wx' },
      );
    } catch (errore) {
      if (
        typeof errore === 'object' &&
        errore !== null &&
        'code' in errore &&
        errore.code === 'EEXIST'
      ) {
        throw new Error(
          'Esiste già un file con questo nome. ' +
          'Scegli un nome nuovo: nessun file è stato sovrascritto.',
        );
      }

      throw errore;
    }

    return risultato.filePath;
  },
);

app.whenReady().then(() => {
  impostaMenuItaliano();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
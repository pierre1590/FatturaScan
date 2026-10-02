import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  type MenuItemConstructorOptions,
} from 'electron';
import { autoUpdater } from 'electron-updater';

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

declare const MAIN_WINDOW_WEBPACK_ENTRY: string;
declare const MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY: string;

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

const pdfSelezionati = new Set<string>();

let verificaAggiornamentiInCorso = false;
let downloadAggiornamentoInCorso = false;
let aggiornamentoScaricato = false;
let dialogoDownloadAperto = false;
let versioneScaricata: string | null = null;

function finestraPrincipale(): BrowserWindow | undefined {
  return (
    BrowserWindow.getFocusedWindow() ??
    BrowserWindow.getAllWindows()[0]
  );
}

async function mostraAggiornamenti(
  message: string,
  detail?: string,
  type: 'info' | 'error' = 'info',
): Promise<void> {
  const opzioni = {
    type,
    title: 'Aggiornamenti FatturaScan',
    message,
    detail,
    buttons: ['Chiudi'],
  };

  const finestra = finestraPrincipale();

  if (finestra) {
    await dialog.showMessageBox(finestra, opzioni);
  } else {
    await dialog.showMessageBox(opzioni);
  }
}

async function installaAggiornamento(
  versione: string,
): Promise<void> {
  if (
    lottoDaProteggere ||
    !aggiornamentoScaricato ||
    versioneScaricata !== versione
  ) {
    await mostraAggiornamenti(
      'Installazione rimandata',
      'Il lotto non è vuoto oppure l’aggiornamento non è pronto.',
    );
    return;
  }

  installazioneAggiornamentoAutorizzata = true;
  autoUpdater.quitAndInstall();
}

async function proponiInstallazione(versione: string): Promise<void> {
  if (lottoDaProteggere) {
    await mostraAggiornamenti(
      `FatturaScan ${versione} è pronta`,
      'L’aggiornamento è scaricato. Prima conferma ed esporta ' +
        'le fatture, quindi premi «Nuovo lotto» e torna in ' +
        'Aiuto → Verifica aggiornamenti.',
    );
    return;
  }

  const opzioni = {
    type: 'question' as const,
    title: 'Aggiornamenti FatturaScan',
    message: `FatturaScan ${versione} è pronta`,
    detail: 'Vuoi installare l’aggiornamento e riavviare ora?',
    buttons: ['Installa e riavvia', 'Più tardi'],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  };

  const finestra = finestraPrincipale();
  const scelta = finestra
    ? await dialog.showMessageBox(finestra, opzioni)
    : await dialog.showMessageBox(opzioni);

  if (scelta.response !== 0) return;

  await installaAggiornamento(versione);
}



async function verificaAggiornamenti(): Promise<void> {
  if (verificaAggiornamentiInCorso) return;

  if (!app.isPackaged || process.platform !== 'win32') {
    await mostraAggiornamenti(
      'Verifica disponibile solo nell’app Windows installata',
      'Non è possibile provare gli aggiornamenti con npm start.',
    );
    return;
  }

  if (aggiornamentoScaricato && versioneScaricata) {
  await proponiInstallazione(versioneScaricata);
  return;
}

  verificaAggiornamentiInCorso = true;

  try {
    const risultato = await autoUpdater.checkForUpdates();

    if (!risultato) {
      await mostraAggiornamenti(
        'Impossibile eseguire la verifica degli aggiornamenti',
        'Controlla di aver avviato l’app installata con NSIS.',
        'error',
      );
      return;
    }

    // La verifica produce uno dei due eventi: update-available o update-not-available.
    // I messaggi all’utente vengono gestiti dai relativi listener qui sotto.
  } catch (errore) {
    await mostraAggiornamenti(
      'Verifica degli aggiornamenti non riuscita',
      errore instanceof Error ? errore.message : String(errore),
      'error',
    );
  } finally {
    verificaAggiornamentiInCorso = false;
  }
}

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

  mainWindow.webContents.on('did-start-navigation', () => {
    lottoDaProteggere = true;
  });

  mainWindow.webContents.on('render-process-gone', () => {
    lottoDaProteggere = true;
  });

  mainWindow.on('close', (evento) => {
  if (installazioneAggiornamentoAutorizzata) {
    return;
  }

  if (!lottoDaProteggere) {
    return;
  }

  const scelta = dialog.showMessageBoxSync(mainWindow, {
    type: 'warning',
    title: 'Lotto non completato',
    message: 'Hai un lotto con fatture da confermare o esportare.',
    detail:
      'Conferma ed esporta le fatture oppure usa «Nuovo lotto» ' +
        'prima di chiudere FatturaScan.',
    buttons: ['Annulla chiusura', 'Chiudi comunque'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  });

  if (scelta === 0) {
    evento.preventDefault();
  }
});

  mainWindow.on('closed', () => {
    lottoDaProteggere = true;
  });

  void mainWindow.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);
}

function impostaMenuItaliano(): void {
  const modello: MenuItemConstructorOptions[] = [
    {
      label: "File",
      submenu: [{ label: "Esci", role: "quit" }],
    },
    {
      label: "Modifica",
      submenu: [
        { label: "Annulla", role: "undo" },
        { label: "Ripristina", role: "redo" },
        { type: "separator" },
        { label: "Taglia", role: "cut" },
        { label: "Copia", role: "copy" },
        { label: "Incolla", role: "paste" },
        { type: "separator" },
        { label: "Seleziona tutto", role: "selectAll" },
      ],
    },
    {
      label: "Aiuto",
      submenu: [
        {
          label: "Informazioni su FatturaScan",
          click: () => {
            const finestra =
              BrowserWindow.getFocusedWindow() ??
              BrowserWindow.getAllWindows()[0];

            const opzioni = {
              type: "info" as const,
              title: "Informazioni su FatturaScan",
              message: app.getName(),
              detail:
                `Versione ${app.getVersion()}\n` + ` Autore: Piero Sabino`,

              buttons: ["Chiudi"],
            };

            if (finestra) {
              void dialog.showMessageBox(finestra, opzioni);
            } else {
              void dialog.showMessageBox(opzioni);
            }
          },
        },
        {
          label: "Verifica aggiornamenti",
          click: () => {
            void verificaAggiornamenti();
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

let lottoDaProteggere = true;
let installazioneAggiornamentoAutorizzata = false;

ipcMain.on('fatture:stato-lotto', (evento, valore: unknown) => {
  if (!richiestaValida(evento) || typeof valore !== 'boolean') {
    return;
  }

  lottoDaProteggere = valore;
});


autoUpdater.on('update-available', (info) => {
  void (async () => {
    if (
      dialogoDownloadAperto ||
      downloadAggiornamentoInCorso ||
      aggiornamentoScaricato
    ) {
      return;
    }

    dialogoDownloadAperto = true;

    try {
      const opzioni = {
        type: 'question' as const,
        title: 'Aggiornamenti FatturaScan',
        message: `È disponibile FatturaScan ${info.version}`,
        detail: 'Vuoi scaricare l’aggiornamento adesso? L’app resterà aperta.',
        buttons: ['Scarica', 'Più tardi'],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      };

      const finestra = finestraPrincipale();
      const scelta = finestra
        ? await dialog.showMessageBox(finestra, opzioni)
        : await dialog.showMessageBox(opzioni);

      if (scelta.response !== 0 || downloadAggiornamentoInCorso) {
        return;
      }

      downloadAggiornamentoInCorso = true;

      try {
        await autoUpdater.downloadUpdate();
      } catch (errore) {
        await mostraAggiornamenti(
          'Download dell’aggiornamento non riuscito',
          errore instanceof Error ? errore.message : String(errore),
          'error',
        );
      } finally {
        downloadAggiornamentoInCorso = false;
      }
    } finally {
      dialogoDownloadAperto = false;
    }
  })();
});


autoUpdater.on('update-downloaded', (info) => {
  aggiornamentoScaricato = true;
  versioneScaricata = info.version;
  void proponiInstallazione(info.version);
});

autoUpdater.on('update-not-available', () => {
  void mostraAggiornamenti(
    'FatturaScan è aggiornata',
    `Versione installata: ${app.getVersion()}.`,
  );
});

app.whenReady().then(() => {
  if (app.isPackaged && process.platform === 'win32') {
  autoUpdater.setFeedURL({
    provider: 'github',
    owner: 'pierre1590',
    repo: 'FatturaScan',
  });

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
}

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
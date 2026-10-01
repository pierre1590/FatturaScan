/**
 * This file will automatically be loaded by webpack and run in the "renderer" context.
 * To learn more about the differences between the "main" and the "renderer" context in
 * Electron, visit:
 *
 * https://electronjs.org/docs/latest/tutorial/process-model
 *
 * By default, Node.js integration in this file is disabled. When enabling Node.js integration
 * in a renderer process, please be aware of potential security implications. You can read
 * more about security risks here:
 *
 * https://electronjs.org/docs/tutorial/security
 */
import * as pdfjsLib from 'pdfjs-dist';
import * as XLSX from 'xlsx';
import { estraiImportiDalTesto } from './estrai-importi';
import { raggruppaFatture } from './raggruppa-fatture';
import './index.css';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

type Fattura = {
  percorso: string;
  nome: string;
  imponibile: number | null;
  cap: number | null;
  bollo: number | null;
  totale: number | null;
  confermata: boolean;
  testo: string;
  paginaIniziale: number;
  paginaFinale: number;
  confineIncerto: boolean;
};

type PaginaLetta = {
  numero: number;
  testo: string;
  richiedeOCR: boolean;
};

type IdentitaLotto = {
  cliente: string;
  anno: number;
};

declare global {
  interface Window {
    fattureAPI: {
      selezionaPDF: () => Promise<string[]>;
      leggiPDF: (percorso: string) => Promise<Uint8Array>;
      salvaExcel: (
        dati: Uint8Array,
        nomeFile: string,
      ) => Promise<string | null>;
    };
  }
}

const bottonePDF = document.querySelector<HTMLButtonElement>(
  '#seleziona-pdf',
)!;

const bottoneNuovoLotto = document.querySelector<HTMLButtonElement>(
  '#nuovo-lotto',
)!;

const bottoneConfermaTutte = document.querySelector<HTMLButtonElement>(
  '#conferma-tutte',
)!;

const bottoneEsporta = document.querySelector<HTMLButtonElement>(
  '#esporta-excel',
)!;

const campoCliente = document.querySelector<HTMLInputElement>(
  '#cliente',
)!;

const campoAnno = document.querySelector<HTMLInputElement>('#anno')!;

const tabella = document.querySelector<HTMLTableSectionElement>(
  '#tabella-fatture',
)!;

const messaggio = document.querySelector<HTMLElement>('#messaggio')!;
const scheda = document.querySelector<HTMLElement>('#scheda-revisione')!;
const documento = document.querySelector<HTMLElement>(
  '#documento-selezionato',
)!;

const statoLettura = document.querySelector<HTMLElement>(
  '#stato-lettura',
)!;

const testoLetto = document.querySelector<HTMLElement>('#testo-letto')!;
const form = document.querySelector<HTMLFormElement>('#form-revisione')!;
const controllo = document.querySelector<HTMLElement>(
  '#controllo-importi',
)!;

const campi = {
  imponibile: document.querySelector<HTMLInputElement>('#imponibile')!,
  cap: document.querySelector<HTMLInputElement>('#cap')!,
  bollo: document.querySelector<HTMLInputElement>('#bollo')!,
  totale: document.querySelector<HTMLInputElement>('#totale')!,
};

const fatture: Fattura[] = [];
let fatturaSelezionata: Fattura | null = null;
let identitaLotto: IdentitaLotto | null = null;
let lottoEsportato = false;

const formatoEuro = new Intl.NumberFormat('it-IT', {
  style: 'currency',
  currency: 'EUR',
});

function nomeDaPercorso(percorso: string): string {
  return percorso.split(/[\\/]/).pop() || percorso;
}

function mostraImporto(centesimi: number | null): string {
  return centesimi === null
    ? '—'
    : formatoEuro.format(centesimi / 100);
}

function valoreCampo(centesimi: number | null): string {
  return centesimi === null
    ? ''
    : (centesimi / 100).toFixed(2).replace('.', ',');
}

function leggiCentesimi(testo: string): number | null {
  const pulito = testo.trim().replace(/\s/g, '');

  if (
    !/^(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d{1,2})?$/.test(
      pulito,
    )
  ) {
    return null;
  }

  const [interi, decimali = ''] = pulito.split(',');
  const euro = Number(interi.replace(/\./g, ''));
  const centesimi = Number(decimali.padEnd(2, '0'));
  const valore = euro * 100 + centesimi;

  return Number.isSafeInteger(valore) ? valore : null;
}

function leggiIdentitaLotto(): IdentitaLotto | null {
  const cliente = campoCliente.value.trim().replace(/\s+/g, ' ');
  const annoTesto = campoAnno.value.trim();
  const anno = Number(annoTesto);

  if (
    !cliente ||
    !/^\d{4}$/.test(annoTesto) ||
    !Number.isInteger(anno) ||
    anno < 2000 ||
    anno > 2100
  ) {
    return null;
  }

  return { cliente, anno };
}

function creaCella(testo: string): HTMLTableCellElement {
  const cella = document.createElement('td');
  cella.textContent = testo;
  return cella;
}

async function estraiPaginePDF(
  dati: Uint8Array,
): Promise<PaginaLetta[]> {
  const caricamentoPDF = pdfjsLib.getDocument({ data: dati });
  const documentoPDF = await caricamentoPDF.promise;
  const pagine: PaginaLetta[] = [];

  try {
    for (
      let numero = 1;
      numero <= documentoPDF.numPages;
      numero++
    ) {
      const pagina = await documentoPDF.getPage(numero);
      const contenuto = await pagina.getTextContent();

      const testo = contenuto.items
        .map((elemento) => {
          if (!('str' in elemento)) {
            return '';
          }

          return elemento.str + (elemento.hasEOL ? '\n' : ' ');
        })
        .join('')
        .trim();

      pagine.push({
        numero,
        testo,
        richiedeOCR: testo.length === 0,
      });
    }
  } finally {
    await caricamentoPDF.destroy();
  }

  return pagine;
}

function aggiornaTabella(): void {
  tabella.replaceChildren();

  if (fatture.length === 0) {
    const riga = document.createElement('tr');
    const cella = creaCella('Nessuna fattura inserita.');

    cella.colSpan = 6;
    cella.className = 'empty';

    riga.appendChild(cella);
    tabella.appendChild(riga);
    return;
  }

  for (const fattura of fatture) {
    const riga = document.createElement('tr');

    riga.className = 'riga-selezionabile';

    if (fattura === fatturaSelezionata) {
      riga.classList.add('selezionata');
    }

    const cellaNome = document.createElement('td');
    const pulsante = document.createElement('button');

    pulsante.type = 'button';
    pulsante.className = 'pulsante-documento';
    pulsante.textContent = fattura.nome;
    pulsante.title = fattura.percorso;

    pulsante.addEventListener('click', () => {
      void selezionaFattura(fattura);
    });

    cellaNome.appendChild(pulsante);
    riga.appendChild(cellaNome);

    riga.appendChild(creaCella(mostraImporto(fattura.imponibile)));
    riga.appendChild(creaCella(mostraImporto(fattura.cap)));
    riga.appendChild(creaCella(mostraImporto(fattura.bollo)));
    riga.appendChild(creaCella(mostraImporto(fattura.totale)));

    const cellaStato = document.createElement('td');
    const stato = document.createElement('span');

    stato.className = fattura.confermata
      ? 'status confermata'
      : 'status';

    stato.textContent = fattura.confermata
      ? 'Confermata'
      : fattura.confineIncerto
        ? 'Confine da verificare'
        : 'Da verificare';

    cellaStato.appendChild(stato);
    riga.appendChild(cellaStato);

    tabella.appendChild(riga);
  }
}

async function selezionaFattura(
  fattura: Fattura,
): Promise<void> {
  fatturaSelezionata = fattura;
  scheda.hidden = false;

  documento.textContent = `Documento: ${fattura.nome}`;
  statoLettura.textContent = 'Testo già letto dal PDF.';
  testoLetto.textContent = fattura.testo;

  campi.imponibile.value = valoreCampo(fattura.imponibile);
  campi.cap.value = valoreCampo(fattura.cap);
  campi.bollo.value = valoreCampo(fattura.bollo);
  campi.totale.value = valoreCampo(fattura.totale);

  controllo.textContent = '';
  controllo.className = '';

  aggiornaTabella();

  scheda.scrollIntoView({
    behavior: 'smooth',
    block: 'nearest',
  });
}

function fatturaValidaPerConferma(fattura: Fattura): boolean {
  return (
    !fattura.confineIncerto &&
    Boolean(fattura.testo.trim()) &&
    !fattura.testo.includes('[Scansione: OCR necessario]') &&
    fattura.imponibile !== null &&
    fattura.cap !== null &&
    fattura.bollo !== null &&
    fattura.totale !== null &&
    fattura.imponibile + fattura.cap + fattura.bollo ===
      fattura.totale
  );
}

function nomeFileCliente(cliente: string): string {
  return cliente
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'Cliente';
}

bottonePDF.addEventListener('click', async () => {
  const identitaInserita = leggiIdentitaLotto();

  if (!identitaInserita) {
    messaggio.textContent =
      'Inserisci il nome del cliente e un anno valido prima di caricare i PDF.';

    if (!campoCliente.value.trim()) {
      campoCliente.focus();
    } else {
      campoAnno.focus();
    }

    return;
  }

  if (
    identitaLotto &&
    (
      identitaLotto.cliente !== identitaInserita.cliente ||
      identitaLotto.anno !== identitaInserita.anno
    )
  ) {
    messaggio.textContent =
      'Questo lotto appartiene già a un altro cliente o anno. ' +
      'Esportalo oppure avvia un nuovo lotto.';
    return;
  }

  if (!window.fattureAPI?.selezionaPDF) {
    messaggio.textContent =
      'Selezione PDF non disponibile. Chiudi e riavvia l’app.';
    return;
  }

  bottonePDF.disabled = true;

  try {
    const percorsi = await window.fattureAPI.selezionaPDF();

    if (percorsi.length === 0) {
      messaggio.textContent = 'Nessun PDF selezionato.';
      return;
    }

    const presenti = new Set(
      fatture.map((fattura) => fattura.percorso),
    );

    let fattureAggiunte = 0;

    for (const percorso of percorsi) {
      if (presenti.has(percorso)) {
        continue;
      }

      const datiPDF = await window.fattureAPI.leggiPDF(percorso);
      const pagine = await estraiPaginePDF(datiPDF);
      const gruppi = raggruppaFatture(pagine);

      for (const [indice, gruppo] of gruppi.entries()) {
        const proposta = estraiImportiDalTesto(gruppo.testo);

        fatture.push({
          percorso,
          nome:
            `${nomeDaPercorso(percorso)} — Fattura ${indice + 1}` +
            ` (p. ${gruppo.paginaIniziale}` +
            (
              gruppo.paginaFinale === gruppo.paginaIniziale
                ? ')'
                : `–${gruppo.paginaFinale})`
            ),
          imponibile: proposta.importi.imponibile,
          cap: proposta.importi.cap,
          bollo: proposta.importi.bollo,
          totale: proposta.importi.totale,
          confermata: false,
          testo: gruppo.testo,
          paginaIniziale: gruppo.paginaIniziale,
          paginaFinale: gruppo.paginaFinale,
          confineIncerto: gruppo.confineIncerto,
        });

        fattureAggiunte++;
      }

      presenti.add(percorso);
    }

    if (fattureAggiunte === 0) {
      messaggio.textContent =
        'Nessuna nuova fattura aggiunta: i PDF potrebbero essere già nel lotto.';
      return;
    }

    if (identitaLotto === null) {
      identitaLotto = identitaInserita;

      campoCliente.value = identitaLotto.cliente;
      campoAnno.value = String(identitaLotto.anno);

      campoCliente.readOnly = true;
      campoAnno.readOnly = true;
    }

    lottoEsportato = false;

    aggiornaTabella();

    messaggio.textContent =
      `${fatture.length} fatture/gruppi proposti nel lotto. ` +
      'Controlla le righe prima di confermarle.';
  } catch (errore) {
    console.error('Errore selezione PDF:', errore);

    messaggio.textContent =
      'Errore nella selezione o lettura dei PDF.';
  } finally {
    bottonePDF.disabled = false;
  }
});

form.addEventListener('submit', (evento) => {
  evento.preventDefault();

  if (!fatturaSelezionata) {
    return;
  }

  const imponibile = leggiCentesimi(campi.imponibile.value);
  const cap = leggiCentesimi(campi.cap.value);

  const bollo = campi.bollo.value.trim() === ''
    ? 0
    : leggiCentesimi(campi.bollo.value);

  const totale = leggiCentesimi(campi.totale.value);

  if (
    imponibile === null ||
    cap === null ||
    bollo === null ||
    totale === null
  ) {
    controllo.textContent =
      'Inserisci imponibile, C.A.P. e totale in euro: per esempio 105,84. ' +
      'Il bollo può restare vuoto se è pari a 0,00.';

    controllo.className = 'errore';
    return;
  }

  if (imponibile + cap + bollo !== totale) {
    const differenza = totale - imponibile - cap - bollo;

    controllo.textContent =
      `Totale non coerente: differenza ${mostraImporto(differenza)}. ` +
      'Controlla gli importi sul documento.';

    controllo.className = 'errore';
    return;
  }

  fatturaSelezionata.imponibile = imponibile;
  fatturaSelezionata.cap = cap;
  fatturaSelezionata.bollo = bollo;
  fatturaSelezionata.totale = totale;
  fatturaSelezionata.confermata = true;

  lottoEsportato = false;

  controllo.textContent = 'Importi coerenti. Fattura confermata.';
  controllo.className = 'successo';

  aggiornaTabella();
});

bottoneConfermaTutte.addEventListener('click', () => {
  const daConfermare = fatture.filter(
    (fattura) => !fattura.confermata,
  );

  const valide = daConfermare.filter(
    fatturaValidaPerConferma,
  );

  if (valide.length === 0) {
    messaggio.textContent =
      'Nessuna fattura confermabile in blocco: controlla importi e confini delle pagine.';
    return;
  }

  const escluse = daConfermare.length - valide.length;

  const conferma = window.confirm(
    `Confermare ${valide.length} fatture valide? ` +
    `${escluse} resteranno da verificare.`,
  );

  if (!conferma) {
    return;
  }

  for (const fattura of valide) {
    fattura.confermata = true;
  }

  lottoEsportato = false;

  aggiornaTabella();

  messaggio.textContent =
    `${valide.length} fatture confermate insieme. ` +
    `${escluse} ancora da verificare.`;
});

bottoneEsporta.addEventListener('click', async () => {
  if (!identitaLotto) {
    messaggio.textContent =
      'Inserisci Cliente e Anno e carica almeno un PDF.';
    return;
  }

  const confermate = fatture.filter(
    (fattura) => fattura.confermata,
  );

  if (confermate.length === 0) {
    messaggio.textContent =
      'Non ci sono fatture confermate da esportare.';
    return;
  }

  bottoneEsporta.disabled = true;

  try {
    const { cliente, anno } = identitaLotto;

    const righe: (string | number)[][] = [
      [`Fatture - ${cliente} - ${anno}`],
      [],
      ['N.', 'Imponibile', 'C.A.P.', 'Bollo', 'Totale riga'],
    ];

    for (const [indice, fattura] of confermate.entries()) {
      const { imponibile, cap, bollo, totale } = fattura;

      if (
        imponibile === null ||
        cap === null ||
        bollo === null ||
        totale === null
      ) {
        throw new Error(
          `Importi mancanti nella fattura ${fattura.nome}`,
        );
      }

      righe.push([
        indice + 1,
        imponibile / 100,
        cap / 100,
        bollo / 100,
        totale / 100,
      ]);
    }

    const primaRigaDati = 4;
    const ultimaRigaDati =
      primaRigaDati + confermate.length - 1;
    const rigaTotali = ultimaRigaDati + 1;

    const foglio = XLSX.utils.aoa_to_sheet(righe);

    XLSX.utils.sheet_add_aoa(
      foglio,
      [[
        'Totale',
        { t: 'n', f: `SUM(B${primaRigaDati}:B${ultimaRigaDati})` },
        { t: 'n', f: `SUM(C${primaRigaDati}:C${ultimaRigaDati})` },
        { t: 'n', f: `SUM(D${primaRigaDati}:D${ultimaRigaDati})` },
        { t: 'n', f: `SUM(E${primaRigaDati}:E${ultimaRigaDati})` },
      ]],
      { origin: `A${rigaTotali}` },
    );

    foglio['!merges'] = [
      {
        s: { r: 0, c: 0 },
        e: { r: 0, c: 4 },
      },
    ];

    foglio['!cols'] = [
      { wch: 12 },
      { wch: 18 },
      { wch: 16 },
      { wch: 16 },
      { wch: 20 },
    ];

    for (
      let numeroRiga = primaRigaDati;
      numeroRiga <= rigaTotali;
      numeroRiga++
    ) {
      for (const colonna of ['B', 'C', 'D', 'E']) {
        const cella = foglio[`${colonna}${numeroRiga}`];

        if (cella) {
          cella.z = '#,##0.00';
        }
      }
    }

    const cartella = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(
      cartella,
      foglio,
      'Fatture',
    );

    const dati = XLSX.write(cartella, {
      bookType: 'xlsx',
      type: 'array',
    }) as Uint8Array;

    const nomeFile =
      `${nomeFileCliente(cliente)}_${anno}_fatture.xlsx`;

    const percorso = await window.fattureAPI.salvaExcel(
      dati,
      nomeFile,
    );

    if (percorso) {
      lottoEsportato = true;

      messaggio.textContent =
        `${confermate.length} fatture esportate: ${percorso}`;
    } else {
      messaggio.textContent = 'Esportazione annullata.';
    }
  } catch (errore) {
    console.error('Errore esportazione Excel:', errore);

    messaggio.textContent =
      'Esportazione non riuscita: controlla la console.';
  } finally {
    bottoneEsporta.disabled = false;
  }
});

bottoneNuovoLotto.addEventListener('click', () => {
  if (fatture.length > 0) {
    const nonConfermate = fatture.filter(
      (fattura) => !fattura.confermata,
    ).length;

    if (nonConfermate > 0) {
      messaggio.textContent =
        `Nuovo lotto bloccato: ${nonConfermate} fatture ` +
        'sono ancora da verificare.';
      return;
    }

    if (!lottoEsportato) {
      messaggio.textContent =
        'Nuovo lotto bloccato: esporta prima le fatture in Excel.';
      return;
    }
  }

  fatture.length = 0;
  fatturaSelezionata = null;
  identitaLotto = null;
  lottoEsportato = false;

  campoCliente.value = '';
  campoCliente.readOnly = false;

  campoAnno.readOnly = false;

  scheda.hidden = true;
  documento.textContent = 'Nessun documento selezionato.';
  statoLettura.textContent =
    'Seleziona una fattura per avviare la lettura.';
  testoLetto.textContent = '';

  campi.imponibile.value = '';
  campi.cap.value = '';
  campi.bollo.value = '';
  campi.totale.value = '';

  controllo.textContent = '';
  controllo.className = '';

  messaggio.textContent =
    'Nuovo lotto pronto: inserisci il cliente e seleziona i PDF.';

  aggiornaTabella();
  campoCliente.focus();
});

aggiornaTabella();
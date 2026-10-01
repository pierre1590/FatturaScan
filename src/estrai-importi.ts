export type CampoImporto =
  | 'imponibile'
  | 'cap'
  | 'bollo'
  | 'totale';

export type PropostaImporti = Record<CampoImporto, number | null>;

type Candidato = {
  valore: number;
  origine: string;
};

// Formato italiano:
// 1.040,50 | 1040,50 | 1.040 | 1040 | 40 | 40,25
const IMPORTO = String.raw`(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d{1,2})?`;

const ETICHETTE: Record<CampoImporto, RegExp> = {
  imponibile:
    /\b(?:imponibile|compenso|onorario|consulenza|prestazione|importo\s+complessivo|importo)\b/i,

  cap:
    /\b(?:c\.?\s*a\.?\s*p\.?|contributo(?:\s+(?:int(?:egrativo)?|previdenziale))?|rivalsa\s+(?:previdenziale|inps))\b/i,

  bollo:
    /\b(?:imposta\s+di\s+bollo|marca\s+da\s+bollo|bollo)\b/i,

  totale:
    /\b(?:totale\s+fattura|totale\s+documento|totale\s+da\s+pagare|totale)\b/i,
};

function inCentesimi(testo: string): number | null {
  const pulito = testo.trim().replace(/[€\s]/g, '');

  if (!new RegExp(`^${IMPORTO}$`).test(pulito)) {
    return null;
  }

  const [interi, decimali = ''] = pulito.split(',');
  const euro = Number(interi.replace(/\./g, ''));
  const centesimi = Number(decimali.padEnd(2, '0'));

  if (
    !Number.isSafeInteger(euro) ||
    !Number.isSafeInteger(centesimi) ||
    centesimi < 0 ||
    centesimi > 99
  ) {
    return null;
  }

  return euro * 100 + centesimi;
}

function importiNellaRiga(riga: string): number[] {
  const risultati: number[] = [];
  const espressione = new RegExp(IMPORTO, 'g');

  for (const corrispondenza of riga.matchAll(espressione)) {
    const testoImporto = corrispondenza[0];
    const inizio = corrispondenza.index;
    const fine = inizio + testoImporto.length;

    const caratterePrima = riga[inizio - 1] ?? '';
    const carattereDopo = riga[fine] ?? '';

    // "4%" è una percentuale; non è il valore del contributo.
    if (carattereDopo === '%') {
      continue;
    }

    // Scarta solo importi inglobati in un altro numero.
    // Il simbolo € è un separatore valido e non deve far scartare 2,00.
    if (/[0-9.,]/.test(caratterePrima + carattereDopo)) {
      continue;
    }

    const valore = inCentesimi(testoImporto);

    if (valore !== null) {
      risultati.push(valore);
    }
  }

  return risultati;
}

function contieneEtichettaDiversa(
  riga: string,
  campoCorrente: CampoImporto,
): boolean {
  return (Object.entries(ETICHETTE) as [CampoImporto, RegExp][]).some(
    ([campo, espressione]) =>
      campo !== campoCorrente && espressione.test(riga),
  );
}

function trovaCandidati(
  testo: string,
  campo: CampoImporto,
): Candidato[] {
  const righe = testo
    .split(/\r?\n/)
    .map((riga) => riga.trim())
    .filter(Boolean);

  const candidati: Candidato[] = [];

  righe.forEach((riga, indice) => {
    if (!ETICHETTE[campo].test(riga)) {
      return;
    }

    // "La fattura supera 77,47 euro" esprime una soglia,
    // non il valore del bollo da registrare.
   if (campo === 'bollo') {
  // Scarta frasi normative e soglie, non importi di bollo.
  // Esempi:
  // - "Imposta di bollo assolta ai sensi dell'art. 13..."
  // - "solo se la fattura supera 77,47 euro"
  if (
    /\b(?:supera|oltre|inferiore|maggiore|soglia|art\.?|articolo|dpr|legge|tariffa|comma|provvedimento)\b/i
      .test(riga)
  ) {
    return;
  }
}

    const importi = importiNellaRiga(riga);
    console.log('Candidato', campo, riga, importi);

    // Una sola cifra utile nella riga dell'etichetta.
    if (importi.length === 1) {
      candidati.push({
        valore: importi[0],
        origine: riga,
      });

      return;
    }

    // Se etichetta e importo sono su righe diverse, controlla
    // solo la riga successiva e solo se non contiene una nuova etichetta.
    const rigaSuccessiva = righe[indice + 1];

    if (
      !rigaSuccessiva ||
      contieneEtichettaDiversa(rigaSuccessiva, campo)
    ) {
      return;
    }

    const importiSuccessivi = importiNellaRiga(rigaSuccessiva);

    if (importiSuccessivi.length === 1) {
      candidati.push({
        valore: importiSuccessivi[0],
        origine: `${riga} / ${rigaSuccessiva}`,
      });
    }
  });

  return candidati;
}

function valoreUnivoco(candidati: Candidato[]): number | null {
  const valori = [...new Set(candidati.map((candidato) => candidato.valore))];

  return valori.length === 1 ? valori[0] : null;
}

export function estraiImportiDalTesto(
  testo: string,
): {
  importi: PropostaImporti;
  avvisi: string[];
} {
  const importi: PropostaImporti = {
    imponibile: null,
    cap: null,
    bollo: null,
    totale: null,
  };

  const avvisi: string[] = [];

  for (const campo of Object.keys(importi) as CampoImporto[]) {
    const candidati = trovaCandidati(testo, campo);
    const valore = valoreUnivoco(candidati);

    if (valore !== null) {
      importi[campo] = valore;
      continue;
    }

    if (candidati.length > 1) {
      avvisi.push(
        `${campo}: trovati importi diversi; controlla la fattura.`,
      );
    } else {
      avvisi.push(
        `${campo}: importo non individuato con certezza.`,
      );
    }
  }

  const { imponibile, cap, bollo, totale } = importi;

  // Verifica esclusivamente valori espliciti: non inventa importi mancanti.
  if (
    imponibile !== null &&
    cap !== null &&
    bollo !== null &&
    totale !== null &&
    imponibile + cap + bollo !== totale
  ) {
    avvisi.push(
      'La somma dei valori proposti non coincide con il totale.',
    );
  }

  return { importi, avvisi };
}
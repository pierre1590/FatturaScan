export type PaginaFattura = {
  numero: number;
  testo: string;
  richiedeOCR: boolean;
};

export type GruppoFattura = {
  paginaIniziale: number;
  paginaFinale: number;
  testo: string;
  confineIncerto: boolean;
};

function numeroFattura(testo: string): string | null {
  const righe = testo.split(/\r?\n/).slice(0, 30);

  for (const riga of righe) {
    const risultato = riga.match(
      /\b(?:fattura|fatt\.?|n\.?\s*(?:fattura)?)\s*(?:n\.?|numero|nr\.?)?\s*[:\-]?\s*([A-Z0-9][A-Z0-9/_-]{0,24})\b/i,
    );

    if (risultato) {
      const candidato = risultato[1].toUpperCase();

      // "Fattura regime..." non contiene un numero di documento.
      if (!/^(?:REGIME|ELETTRONICA|PROFORMA|DEL|DELLO)$/.test(candidato)) {
        return candidato;
      }
    }
  }

  return null;
}

function inizioFattura(testo: string): boolean {
  const intestazione = testo
    .split(/\r?\n/)
    .slice(0, 45)
    .join(' ');

  const haParolaFattura =
    /\b(?:fattura|fatt\.)\b/i.test(intestazione);

  const haNumero =
    /\b(?:fattura|fatt\.)\s*(?:n\.?|nr\.?|numero)?\s*[:\-]?\s*[A-Z0-9][A-Z0-9/_-]{0,24}\b/i
      .test(intestazione);

  const haData =
    /\b(?:data|del)\s*[:\-]?\s*\d{1,2}[/.]\d{1,2}[/.]\d{2,4}\b/i
      .test(intestazione);

  const haPartitaIVA =
    /\b(?:p\.?\s*iva|partita\s+iva)\b/i.test(intestazione);

  const haCodiceFiscale =
    /\b(?:c\.?\s*f\.?|codice\s+fiscale)\b/i.test(intestazione);

  // Una fattura può non riportare bene il suo numero nel testo estratto.
  // In quel caso, fattura + dati fiscali nell'intestazione sono un segnale
  // sufficiente per aprire un nuovo gruppo.
  return haParolaFattura && (
    haNumero ||
    haData ||
    (haPartitaIVA && haCodiceFiscale)
  );
}

export function raggruppaFatture(
  pagine: PaginaFattura[],
): GruppoFattura[] {
  const gruppi: GruppoFattura[] = [];
  let gruppo: GruppoFattura | null = null;
  let numeroCorrente: string | null = null;

  for (const pagina of pagine) {
    const numero = numeroFattura(pagina.testo);
    const sembraInizio = inizioFattura(pagina.testo);
    const testoPagina = `Pagina ${pagina.numero}\n${
      pagina.testo || '[Scansione: OCR necessario]'
    }`;

    if (gruppo === null) {
      gruppo = {
        paginaIniziale: pagina.numero,
        paginaFinale: pagina.numero,
        testo: testoPagina,
        confineIncerto: pagina.richiedeOCR || !numero,
      };

      numeroCorrente = numero;
      continue;
    }

    // Numeri di fattura diversi indicano due documenti.
    const nuovoDocumento =
      numero !== null &&
      numeroCorrente !== null &&
      numero !== numeroCorrente;

    if (nuovoDocumento) {
      gruppi.push(gruppo);

      gruppo = {
        paginaIniziale: pagina.numero,
        paginaFinale: pagina.numero,
        testo: testoPagina,
        confineIncerto: pagina.richiedeOCR,
      };

      numeroCorrente = numero;
      continue;
    }

    // Se vediamo una nuova intestazione ma manca il numero,
    // apriamo un gruppo separato e segnaliamo l'incertezza.
   if (sembraInizio) {
  gruppi.push(gruppo);

  gruppo = {
    paginaIniziale: pagina.numero,
    paginaFinale: pagina.numero,
    testo: testoPagina,
    confineIncerto: numero === null || pagina.richiedeOCR,
  };

  numeroCorrente = numero;
  continue;
}

    gruppo.paginaFinale = pagina.numero;
    gruppo.testo += `\n\n${testoPagina}`;

    if (pagina.richiedeOCR || (sembraInizio && numero === null)) {
      gruppo.confineIncerto = true;
    }

    if (numeroCorrente === null && numero !== null) {
      numeroCorrente = numero;
    }
  }

  if (gruppo !== null) {
    gruppi.push(gruppo);
  }

  return gruppi;
}
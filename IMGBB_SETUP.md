# Configurazione ImgBB API per Upload Foto Hobbs

## ✅ API Key Già Configurata

La tua API Key di ImgBB è già configurata nel file `script.js`:
```javascript
const IMGBB_API_KEY = '63a0e961fb3af5dada39106e441a29e9';
```

**Non serve fare altro!** L'upload delle foto è già funzionante.

## Come Usare l'Upload Foto

1. **Accedi** all'applicazione
2. **Fai una prenotazione** (clicca su una casella oraria libera)
3. **Clicca sulla prenotazione** → Selezione "✏️ Modifica Hobbs"
4. **Carica le foto**:
   - Clicca su "Scegli file" per la foto Hobbs Partenza
   - Clicca su "Scegli file" per la foto Hobbs Arrivo
   - Su mobile: la fotocamera si aprirà direttamente
5. **Inserisci i valori** Hobbs Partenza e Arrivo
6. **Clicca "Salva"**
7. Le foto vengono caricate su ImgBB e gli URL salvati in Firestore
8. **Verifica**: Clicca nuovamente sulla prenotazione per vedere le foto

## Dettagli Tecnici

### Limiti Gratuiti ImgBB
- **Upload giornalieri**: Illimitati con API Key gratuita
- **Dimensione massima**: 32MB per immagine
- **Formato**: JPG, PNG, GIF, BMP, WEBP
- **Storage**: Permanente e gratuito

### Come Funziona
1. L'utente seleziona una foto dal dispositivo (o scatta con la fotocamera)
2. La foto viene convertita in formato base64
3. Viene caricata su ImgBB tramite API REST
4. ImgBB restituisce un URL permanente (es: `https://i.ibb.co/abc123/image.jpg`)
5. L'URL viene salvato in Firestore nel documento della prenotazione
6. Tutti gli utenti autenticati possono visualizzare la foto tramite l'URL

### Sicurezza
- L'API Key è inclusa nel codice client (sicuro per ImgBB)
- Le foto vengono caricate su ImgBB in modo pubblico
- Gli URL sono difficili da indovinare
- Solo gli utenti autenticati nell'app possono vedere gli URL salvati in Firestore

### Vantaggi ImgBB
- ✅ Nessuna registrazione app necessaria
- ✅ API Key fornita immediatamente
- ✅ Completamente gratuito
- ✅ Più semplice di Imgur
- ✅ Nessun limite di storage
- ✅ CDN globale integrato (caricamento veloce)
- ✅ Dimensioni file maggiori supportate (32MB vs 10MB Imgur)

## Prenotazioni Consecutive

Quando hai più mezz'ore consecutive prenotate:
1. Inserisci i dati Hobbs e le foto sulla prima prenotazione
2. Il sistema ti chiederà: "Hai X prenotazioni consecutive (ora-ora). Vuoi applicare questi dati Hobbs a tutte?"
3. Se rispondi "Sì", i valori e le foto vengono copiati automaticamente su tutte le prenotazioni consecutive
4. Risparmia tempo per voli più lunghi!

## Risoluzione Problemi

### Errore: "Errore upload ImgBB"
- Verifica la connessione internet
- Controlla che la foto sia in un formato supportato (JPG, PNG)
- Prova con una foto più piccola (< 10MB)

### Le foto non si visualizzano
- Controlla la console browser per errori (F12)
- Verifica che l'URL salvato in Firestore sia valido
- Prova ad aprire l'URL direttamente nel browser

### Foto troppo grande
- ImgBB accetta fino a 32MB
- Per ottimizzare, scatta foto con risoluzione media (non massima)
- Le foto vengono comunque compresse automaticamente

## Informazioni API

- **Provider**: ImgBB (https://imgbb.com)
- **API Endpoint**: https://api.imgbb.com/1/upload
- **Documentazione**: https://api.imgbb.com/
- **Piano**: Gratuito permanente

## Supporto

Per problemi con l'applicazione, contatta lo sviluppatore del sistema di prenotazioni.

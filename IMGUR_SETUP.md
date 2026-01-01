# Configurazione Imgur API per Upload Foto Hobbs

## Passo 1: Registrazione Applicazione Imgur

1. Vai su https://api.imgur.com/oauth2/addclient
2. Accedi con un account esistente o creane uno nuovo
3. Compila il modulo:
   - **Application name**: `Prenotazione P96 Aeroclub`
   - **Authorization type**: Seleziona `OAuth 2 authorization without a callback URL`
   - **Email**: La tua email
   - **Description**: `Sistema prenotazioni aeroclub con upload foto Hobbs meter`
4. Accetta i Terms of Service
5. Clicca su **Submit**

## Passo 2: Ottenere il Client ID

Dopo aver inviato il modulo, vedrai una pagina con:
- **Client ID**: Una stringa alfanumerica (es: `abc123def456789`)
- **Client Secret**: Non serve per questa applicazione

**IMPORTANTE**: Copia il **Client ID** - ti servirà nel prossimo passo.

## Passo 3: Configurare l'Applicazione

1. Apri il file `script.js` nell'editor
2. Trova la riga (vicino all'inizio del file):
   ```javascript
   const IMGUR_CLIENT_ID = 'YOUR_IMGUR_CLIENT_ID_HERE';
   ```
3. Sostituisci `'YOUR_IMGUR_CLIENT_ID_HERE'` con il tuo Client ID:
   ```javascript
   const IMGUR_CLIENT_ID = 'abc123def456789';
   ```
4. Salva il file

## Passo 4: Test

1. Accedi all'applicazione
2. Fai una prenotazione
3. Clicca sulla prenotazione → "Modifica Hobbs"
4. Carica una foto di test
5. Clicca "Salva"
6. Verifica che la foto sia visibile cliccando nuovamente sulla prenotazione

## Dettagli Tecnici

### Limiti Gratuiti Imgur
- **Upload giornalieri**: 12,500 immagini
- **Dimensione massima**: 10MB per immagine
- **Formato**: JPG, PNG, GIF, BMP, TIFF
- **Storage**: Illimitato e permanente

### Come Funziona
1. L'utente seleziona una foto dal dispositivo
2. La foto viene convertita in formato base64
3. Viene caricata su Imgur tramite API REST
4. Imgur restituisce un URL permanente (es: `https://i.imgur.com/abc123.jpg`)
5. L'URL viene salvato in Firestore nel documento della prenotazione
6. Tutti gli utenti autenticati possono visualizzare la foto tramite l'URL

### Sicurezza
- Il Client ID è pubblico e progettato per essere usato lato client
- Le foto vengono caricate in modo anonimo su Imgur
- Gli URL sono difficili da indovinare (contengono hash casuali)
- Solo gli utenti autenticati nell'app possono vedere gli URL salvati in Firestore

### Vantaggi vs Firebase Storage
- ✅ Nessuna carta di credito richiesta
- ✅ Completamente gratuito per il tuo caso d'uso
- ✅ Più semplice da configurare
- ✅ Nessun limite di storage
- ✅ CDN globale integrato (caricamento veloce delle immagini)

## Risoluzione Problemi

### Errore: "Configura il Client ID di Imgur"
- Verifica di aver sostituito `YOUR_IMGUR_CLIENT_ID_HERE` con il tuo Client ID effettivo
- Assicurati di mantenere gli apici: `'abc123'`

### Errore: "Errore upload Imgur"
- Verifica la connessione internet
- Controlla che il Client ID sia corretto
- Verifica che la foto sia in un formato supportato (JPG, PNG)
- Prova con una foto più piccola (< 5MB)

### Le foto non si visualizzano
- Controlla la console browser per errori (F12)
- Verifica che l'URL salvato in Firestore sia valido
- Prova ad aprire l'URL direttamente nel browser

## Supporto

Per problemi con l'API Imgur:
- Documentazione: https://apidocs.imgur.com/
- Forum: https://community.imgur.com/

Per problemi con l'applicazione, contatta lo sviluppatore.

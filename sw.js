/* =====================================================================
   Aeroclub dei Marsi — Service Worker
   ---------------------------------------------------------------------
   ⚠️  IMPORTANTE: a OGNI modifica dei file del sito bisogna cambiare
   la riga VERSION qui sotto (stessa revisione mostrata in alto a destra
   nella pagina). È questo che fa comparire ai soci l'avviso
   "È disponibile una nuova versione".
   ===================================================================== */

const VERSION = 'rev15-2026-08-18';

const CORE_CACHE = 'core-' + VERSION;
const RUNTIME_CACHE = 'runtime-' + VERSION;

// File essenziali: scaricati subito, così l'app si apre anche senza rete
const CORE_ASSETS = [
    './',
    './index.html',
    './style.css',
    './script.js',
    './offline.html',
    './manifest.json',
    './logo.jpg',
    './icon-192.png',
    './icon-512.png',
    './icon-maskable-512.png',
    './apple-touch-icon.png'
];

// Domini esterni "immutabili" che conviene tenere in copia locale
// (www.gstatic.com serve gli SDK di Firebase: senza questi l'app non parte offline)
const CDN_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com', 'cdn.jsdelivr.net', 'www.gstatic.com'];

// Indirizzi che NON vanno MAI messi in copia locale:
// dati in tempo reale (prenotazioni, login), meteo, foto, mappe.
const NEVER_CACHE = [
    'firestore.googleapis.com',
    'identitytoolkit.googleapis.com',
    'securetoken.googleapis.com',
    'firebaseinstallations.googleapis.com',
    'firebaseremoteconfig.googleapis.com',
    'api.weatherapi.com',
    'api.imgbb.com',
    'i.ibb.co',
    'windy.com',
    'google-analytics.com',
    'analytics.google.com'
];

// ---------- Installazione ----------
self.addEventListener('install', (event) => {
    // Prende subito il posto della versione precedente: evita che i soci
    // restino con codice vecchio in copia locale dopo un aggiornamento.
    self.skipWaiting();
    event.waitUntil(
        caches.open(CORE_CACHE)
            .then(cache => cache.addAll(CORE_ASSETS))
            .catch(err => console.warn('[SW] precache parziale:', err))
    );
});

// ---------- Attivazione: butta le copie vecchie ----------
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then(keys => Promise.all(
            keys.filter(k => k !== CORE_CACHE && k !== RUNTIME_CACHE)
                .map(k => caches.delete(k))
        )).then(() => self.clients.claim())
    );
});

// ---------- Aggiornamento su richiesta della pagina ----------
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

// ---------- Strategia di rete ----------
self.addEventListener('fetch', (event) => {
    const req = event.request;

    // Solo letture semplici: mai toccare invii di dati
    if (req.method !== 'GET') return;

    const url = new URL(req.url);
    if (NEVER_CACHE.some(h => url.href.includes(h))) return;

    const sameOrigin = url.origin === self.location.origin;

    // Pagine: prima la rete (per avere sempre l'ultima versione), poi la copia locale
    if (req.mode === 'navigate') {
        event.respondWith(
            fetch(req)
                .then(res => {
                    const copy = res.clone();
                    caches.open(CORE_CACHE).then(c => c.put('./index.html', copy));
                    return res;
                })
                .catch(() => caches.match('./index.html')
                    .then(hit => hit || caches.match('./offline.html')))
        );
        return;
    }

    // Codice del sito (js/css): PRIMA la rete, così un aggiornamento è subito attivo.
    // La copia locale resta solo come riserva per l'uso senza campo.
    if (sameOrigin && /\.(js|css)$/i.test(url.pathname)) {
        event.respondWith(
            fetch(req).then(res => {
                if (res && res.status === 200) {
                    const copy = res.clone();
                    caches.open(CORE_CACHE).then(c => c.put(req, copy));
                }
                return res;
            }).catch(() => caches.match(req))
        );
        return;
    }

    // Immagini, PDF, font e librerie esterne: prima la copia locale (veloce),
    // aggiornata in sottofondo. Cambiano di rado.
    if (sameOrigin || CDN_HOSTS.includes(url.hostname)) {
        event.respondWith(
            caches.match(req).then(hit => {
                const network = fetch(req).then(res => {
                    if (res && res.status === 200) {
                        const copy = res.clone();
                        caches.open(RUNTIME_CACHE).then(c => c.put(req, copy));
                    }
                    return res;
                }).catch(() => hit);
                return hit || network;
            })
        );
    }
});

// La tua configurazione Firebase
const firebaseConfig = {
  apiKey: "AIzaSyD35TTyIDxFbKuODtI1tAphm9y4JIcjftA",
  authDomain: "prenotazione-p96-adm.firebaseapp.com",
  projectId: "prenotazione-p96-adm",
  storageBucket: "prenotazione-p96-adm.firebasestorage.app",
  messagingSenderId: "925382218994",
  appId: "1:925382218994:web:1d8bfc92d9dd2454636c6b",
  measurementId: "G-PMEG5ZLMLZ"
};

// ImgBB API Configuration
// IMPORTANTE: La tua API Key di ImgBB
const IMGBB_API_KEY = '63a0e961fb3af5dada39106e441a29e9';

try {
    const app = firebase.initializeApp(firebaseConfig);
    const auth = firebase.auth();
    const db = firebase.firestore();
    const analytics = firebase.analytics();

    // Riferimenti agli elementi HTML
    const loadingMessage = document.getElementById('loading-message');
    const authContainer = document.getElementById('auth-container');
    const appContent = document.getElementById('app-content');
    const signupNameInput = document.getElementById('signup-name');
    const signupSurnameInput = document.getElementById('signup-surname');
    const emailInput = document.getElementById('email');
    const passwordInput = document.getElementById('password'); 
    const loginButton = document.getElementById('login-button');
    const signupButton = document.getElementById('signup-button');
    const logoutButton = document.getElementById('logout-button');
    const userDisplayNameSpan = document.getElementById('user-display-name');
    const authErrorMessage = document.getElementById('auth-error-message');
    const resetPasswordLink = document.getElementById('reset-password-link');

    const displayDateFullSpan = document.getElementById('display-date-full');
    const prevDayButton = document.getElementById('prev-day-button');
    const nextDayButton = document.getElementById('next-day-button');

    const mSunrise = document.getElementById('m-sunrise');
    const mSunset = document.getElementById('m-sunset');
    const mTemp = document.getElementById('m-temp');
    const mWind = document.getElementById('m-wind');
    const mQnh = document.getElementById('m-qnh');
    const mDa = document.getElementById('m-da');
    const daCell = document.getElementById('da-cell');
    const hourlyScheduleDiv = document.getElementById('hourly-schedule');
    const startTimeInput = document.getElementById('start-time');
    const endTimeInput = document.getElementById('end-time');
    const addBookingButton = document.getElementById('add-booking-button');
    const bookingErrorMessage = document.getElementById('booking-error-message');

    // Variabili globali
    window.currentUser = null; 
    window.currentUserRole = null; 
    let currentDisplayDate = new Date();
    currentDisplayDate.setHours(0, 0, 0, 0);

    let bookingsSnapshotUnsubscribe = null;

    // Cache dei voli per socio, popolata da renderMemberTotals()
    // socio_id -> { nome, flights: [...] }
    let memberFlightsCache = {};

    // Registro contatore: elenco piatto dei soli voli COMPLETI (entrambi i valori Hobbs),
    // più il conteggio dei voli incompleti esclusi. Popolati da renderMemberTotals().
    let allCompleteFlights = [];
    let incompleteFlightsCount = 0;

    // Alba/tramonto
    let currentDaySunrise = "00:00"; 
    let currentDaySunset = "23:59"; 

    // Coordinate Celano
    const CELANO_LAT = 42.0667;
    const CELANO_LNG = 13.5500;

    // Funzione per formattare la data
    const formatDateFull = (date) => {
        const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
        return date.toLocaleDateString('it-IT', options);
    };

    const updateDateDisplay = () => {
        displayDateFullSpan.textContent = formatDateFull(currentDisplayDate);
    };
    updateDateDisplay();

    prevDayButton.addEventListener('click', () => {
        currentDisplayDate.setDate(currentDisplayDate.getDate() - 1);
        updateDateDisplay();
        listenToBookings();
        loadWeatherData();
    });

    nextDayButton.addEventListener('click', () => {
        currentDisplayDate.setDate(currentDisplayDate.getDate() + 1);
        updateDateDisplay();
        listenToBookings();
        loadWeatherData();
    });

    // ===============================================================
    //  MODALITÀ AMMINISTRATORE
    //  Permette di registrare una prenotazione per conto di un socio
    //  (es. chi ha volato ma ha dimenticato di prenotare) e di
    //  riassegnare una prenotazione esistente a un altro socio.
    //  Attiva solo per chi ha ruolo 'admin'.
    // ===============================================================
    let elencoSoci = [];   // { id, nome }

    const isAdmin = () => window.currentUserRole === 'admin';

    const caricaElencoSoci = async () => {
        try {
            const snap = await db.collection('users').get();
            const lista = [];
            snap.forEach(doc => {
                const u = doc.data();
                const nome = (u.nome && u.cognome) ? `${u.nome} ${u.cognome}` : (u.email || doc.id);
                lista.push({ id: doc.id, nome });
            });
            lista.sort((a, b) => a.nome.localeCompare(b.nome, 'it'));
            elencoSoci = lista;
            popolaTendineSoci();
        } catch (e) {
            console.error('Elenco soci non caricato:', e);
        }
    };

    const popolaTendineSoci = () => {
        const sel = document.getElementById('admin-socio-select');
        if (sel) {
            const scelto = sel.value;
            sel.innerHTML = '<option value="">— Me stesso —</option>' +
                elencoSoci.filter(s => !window.currentUser || s.id !== window.currentUser.uid)
                    .map(s => `<option value="${s.id}">${s.nome}</option>`).join('');
            if (scelto) sel.value = scelto;
        }
        const re = document.getElementById('admin-reassign-select');
        if (re) re.innerHTML = elencoSoci.map(s => `<option value="${s.id}">${s.nome}</option>`).join('');
    };

    // Socio per cui si sta prenotando: null = se stessi
    const socioSelezionato = () => {
        if (!isAdmin()) return null;
        const sel = document.getElementById('admin-socio-select');
        const v = sel ? sel.value : '';
        return v || null;
    };
    const nomeSocio = (id) => {
        const s = elencoSoci.find(x => x.id === id);
        return s ? s.nome : 'socio';
    };

    const aggiornaIndicatorePerConto = () => {
        const box = document.getElementById('qb-onbehalf');
        if (!box) return;
        const id = socioSelezionato();
        if (id) {
            box.textContent = `per conto di ${nomeSocio(id)}`;
            box.style.display = '';
        } else {
            box.style.display = 'none';
        }
    };

    // Mostra/nasconde i comandi riservati all'amministratore
    const aggiornaVistaAdmin = () => {
        const panel = document.getElementById('admin-panel');
        if (panel) panel.style.display = isAdmin() ? '' : 'none';
        if (isAdmin() && elencoSoci.length === 0) caricaElencoSoci();
        aggiornaIndicatorePerConto();
    };

    // --- Funzione per aggiungere prenotazione ---
    const addBookingLogic = async (start, end) => {
        if (!window.currentUser) {
            bookingErrorMessage.textContent = "Devi essere loggato per prenotare.";
            return;
        }

        const startTime = start;
        const endTime = end;
        const bookingDate = new Date(currentDisplayDate);
        bookingDate.setHours(0, 0, 0, 0);

        // L'aereo non c'è: nessuna prenotazione dentro una trasferta
        const _s = new Date(currentDisplayDate); const [_sh, _sm] = startTime.split(':').map(Number);
        _s.setHours(_sh, _sm, 0, 0);
        const _e = new Date(currentDisplayDate); const [_eh, _em] = endTime.split(':').map(Number);
        _e.setHours(_eh, _em, 0, 0);
        const _tras = trasfertaPerFascia(_s, _e);
        if (_tras) {
            bookingErrorMessage.textContent = "In quelle ore l'aereo è in trasferta e non è disponibile.";
            return;
        }

        bookingErrorMessage.textContent = '';

        // Verifica se si sta cercando di prenotare in una data passata
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        if (bookingDate < today && window.currentUserRole !== 'admin') {
            bookingErrorMessage.textContent = "Non è possibile prenotare in date passate. Solo l'amministratore può farlo.";
            return;
        }

        if (!startTime || !endTime) {
            bookingErrorMessage.textContent = "Inserisci orario di inizio e fine.";
            return;
        }

        const [startHour, startMinute] = startTime.split(':').map(Number);
        const [endHour, endMinute] = endTime.split(':').map(Number);

        const newBookingStart = new Date(currentDisplayDate);
        newBookingStart.setHours(startHour, startMinute, 0, 0);
        const newBookingEnd = new Date(currentDisplayDate);
        newBookingEnd.setHours(endHour, endMinute, 0, 0);

        if (newBookingStart >= newBookingEnd) {
            bookingErrorMessage.textContent = "L'orario di fine deve essere successivo all'orario di inizio.";
            return;
        }

        // Validazione alba/tramonto
        const sunrise = new Date(currentDisplayDate);
        const [srHour, srMinute] = currentDaySunrise.split(':').map(Number);
        sunrise.setHours(srHour, srMinute, 0, 0);

        const sunset = new Date(currentDisplayDate);
        const [ssHour, ssMinute] = currentDaySunset.split(':').map(Number);
        sunset.setHours(ssHour, ssMinute, 0, 0);

        if (newBookingStart < sunrise || newBookingEnd > sunset) {
            bookingErrorMessage.textContent = `Non è possibile prenotare durante le ore di buio (Alba: ${currentDaySunrise}, Tramonto: ${currentDaySunset}).`;
            return;
        }

        // L'amministratore può registrare anche voli già avvenuti (prenotazioni dimenticate)
        if (currentDisplayDate.toDateString() === new Date().toDateString()
            && newBookingEnd < new Date()
            && window.currentUserRole !== 'admin') {
            bookingErrorMessage.textContent = "Non è possibile prenotare orari già passati.";
            return;
        }

        const dayStart = new Date(currentDisplayDate);
        dayStart.setHours(0,0,0,0);
        const nextDayStart = new Date(currentDisplayDate);
        nextDayStart.setDate(nextDayStart.getDate() + 1);
        nextDayStart.setHours(0,0,0,0);

        const existingBookingsSnapshot = await db.collection('bookings')
            .where('data', '>=', dayStart)
            .where('data', '<', nextDayStart)
            .get();

        const existingBookings = existingBookingsSnapshot.docs.map(doc => doc.data());

        for (const booking of existingBookings) {
            const existingStart = new Date(currentDisplayDate);
            const [bkStartHour, bkStartMinute] = booking.ora_inizio.split(':').map(Number);
            existingStart.setHours(bkStartHour, bkStartMinute, 0, 0);

            const existingEnd = new Date(currentDisplayDate);
            const [bkEndHour, bkEndMinute] = booking.ora_fine.split(':').map(Number);
            existingEnd.setHours(bkEndHour, bkEndMinute, 0, 0);

            if (newBookingStart < existingEnd && newBookingEnd > existingStart) {
                bookingErrorMessage.textContent = "Orario selezionato si sovrappone con una prenotazione esistente.";
                return;
            }
        }

        const bookingDurationMs = newBookingEnd.getTime() - newBookingStart.getTime();
        const maxDurationMs = 3 * 60 * 60 * 1000;
        if (bookingDurationMs > maxDurationMs) {
            bookingErrorMessage.textContent = "La durata massima di una prenotazione è di 3 ore.";
            return;
        }

        try {
            const perConto = socioSelezionato();
            await db.collection('bookings').add({
                aeromobile_id: 'Tecnam P96',
                socio_id: perConto || window.currentUser.uid,
                // traccia di chi ha inserito la prenotazione al posto del socio
                inserita_da: perConto ? window.currentUser.uid : null,
                data: firebase.firestore.Timestamp.fromDate(bookingDate),
                ora_inizio: startTime,
                ora_fine: endTime,
                hobbs_partenza: null,
                hobbs_arrivo: null,
                stato: 'prenotato',
                timestamp_creazione: firebase.firestore.FieldValue.serverTimestamp()
            });

            bookingErrorMessage.textContent = "";
            if (perConto) admToast(`Prenotazione registrata per ${nomeSocio(perConto)}`);
            if (start === startTimeInput.value && end === endTimeInput.value) {
                startTimeInput.value = "09:00";
                endTimeInput.value = "10:00";
            }
        } catch (error) {
            bookingErrorMessage.textContent = "Errore durante la prenotazione: " + error.message;
        }
    };
    // ===============================================================
    //  CONFIGURAZIONE MANUTENZIONE — da aggiornare a ogni tagliando
    //  Inserisci il valore del contatore Hobbs dell'ultimo intervento.
    //  Lascia null se non lo vuoi mostrare.
    // ===============================================================
    const MANUTENZIONE = {
        ultimo_50h: null,        // es. 150.0  -> prossimo a 200.0
        ultimo_100h: null,       // es. 100.0  -> prossimo a 200.0
        scadenza_annuale: null   // es. '2027-03-15'
    };

    // --- Vento sulla pista 08/26: componente frontale e al traverso ---
    const RUNWAYS = [{ nome: '08', hdg: 80 }, { nome: '26', hdg: 260 }];

    const renderRunwayWind = (windKt, windDeg, gustKt) => {
        const box = document.getElementById('runway-wind');
        if (!box) return;
        if (windKt === null || windKt === undefined || isNaN(windKt) || windDeg === null || isNaN(windDeg)) {
            box.innerHTML = '<p class="rw-empty">Dati vento non disponibili.</p>';
            return;
        }

        const calc = (hdg, v) => {
            let a = ((windDeg - hdg + 540) % 360) - 180; // -180..180
            const rad = a * Math.PI / 180;
            return {
                angolo: a,
                head: v * Math.cos(rad),          // >0 frontale, <0 in coda
                cross: Math.abs(v * Math.sin(rad)),
                lato: a > 0 ? 'da destra' : (a < 0 ? 'da sinistra' : 'in asse')
            };
        };

        // Pista consigliata: quella con vento frontale
        const results = RUNWAYS.map(r => ({ r, c: calc(r.hdg, windKt) }));
        const best = results.reduce((a, b) => (b.c.head > a.c.head ? b : a));

        let html = `<div class="rw-best">Pista favorevole: <strong>${best.r.nome}</strong></div>`;
        html += '<div class="rw-grid">';
        results.forEach(({ r, c }) => {
            const isBest = r.nome === best.r.nome;
            const tail = c.head < -0.5;
            const crossG = (gustKt !== null && !isNaN(gustKt)) ? Math.abs(gustKt * Math.sin(c.angolo * Math.PI / 180)) : null;
            // Soglia indicativa di attenzione sul traverso
            const lvl = c.cross >= 15 ? 'rw-high' : (c.cross >= 10 ? 'rw-warn' : 'rw-ok');
            html += `<div class="rw-card ${isBest ? 'is-best' : ''}">
                <div class="rw-name">Pista ${r.nome}</div>
                <div class="rw-line"><span>${tail ? 'In coda' : 'Frontale'}</span><b>${Math.abs(c.head).toFixed(0)} kt</b></div>
                <div class="rw-line ${lvl}"><span>Traverso ${c.lato}</span><b>${c.cross.toFixed(0)} kt</b></div>
                ${crossG !== null ? `<div class="rw-line rw-gust"><span>Traverso in raffica</span><b>${crossG.toFixed(0)} kt</b></div>` : ''}
            </div>`;
        });
        html += '</div>';
        html += `<p class="rw-note">Vento ${windKt.toFixed(0)} kt da ${Math.round(windDeg)}° (${degToCompass(windDeg)})`;
        if (gustKt !== null && !isNaN(gustKt) && gustKt > windKt + 1) html += ` · raffiche ${gustKt.toFixed(0)} kt`;
        html += '. Valori calcolati sul vento riportato: verificare sempre la manica a vento.</p>';

        box.innerHTML = html;
    };

    // --- Ore alla prossima manutenzione (dal contatore Hobbs più alto) ---
    const renderMaintenance = (flights) => {
        const box = document.getElementById('maintenance-box');
        if (!box) return;

        const current = flights.reduce((mx, f) => (f.ha > mx ? f.ha : mx), 0);
        const cards = [];

        const addCard = (titolo, prossimo) => {
            const restanti = prossimo - current;
            const lvl = restanti <= 5 ? 'mt-high' : (restanti <= 10 ? 'mt-warn' : 'mt-ok');
            cards.push(`<div class="mt-card ${lvl}">
                <div class="mt-title">${titolo}</div>
                <div class="mt-value">${restanti.toFixed(1)} h</div>
                <div class="mt-sub">al contatore ${prossimo.toFixed(1)}</div>
            </div>`);
        };

        if (MANUTENZIONE.ultimo_50h !== null) addCard('Tagliando 50 h', MANUTENZIONE.ultimo_50h + 50);
        if (MANUTENZIONE.ultimo_100h !== null) addCard('Tagliando 100 h', MANUTENZIONE.ultimo_100h + 100);

        if (MANUTENZIONE.scadenza_annuale) {
            const d = new Date(MANUTENZIONE.scadenza_annuale + 'T00:00:00');
            const oggi = new Date(); oggi.setHours(0, 0, 0, 0);
            const giorni = Math.round((d - oggi) / 86400000);
            const lvl = giorni <= 15 ? 'mt-high' : (giorni <= 45 ? 'mt-warn' : 'mt-ok');
            cards.push(`<div class="mt-card ${lvl}">
                <div class="mt-title">Revisione annuale</div>
                <div class="mt-value">${giorni} gg</div>
                <div class="mt-sub">scade il ${d.toLocaleDateString('it-IT')}</div>
            </div>`);
        }

        let html = `<p class="mt-current">Contatore attuale: <strong>${current ? current.toFixed(1) : '—'}</strong> h</p>`;
        if (cards.length > 0) {
            html += `<div class="mt-grid">${cards.join('')}</div>`;
            html += `<p class="disclaimer one-line">(promemoria indicativo – fa fede il libretto dell'aeromobile)</p>`;
        }
        box.innerHTML = html;
    };

    // --- Prenotazioni passate senza contatore completo ---
    const renderIncompleteList = (rows) => {
        const box = document.getElementById('incomplete-box');
        if (!box) return;

        const now = new Date();
        const past = rows.filter(r => {
            if (!r.dateObj) return false;
            const end = new Date(r.dateObj);
            if (r.ora_fine) {
                const [h, m] = r.ora_fine.split(':').map(Number);
                end.setHours(h, m, 0, 0);
            } else {
                end.setHours(23, 59, 59, 999);
            }
            return end < now;
        }).sort((a, b) => (b.dateMs || 0) - (a.dateMs || 0));

        if (past.length === 0) {
            box.innerHTML = '<p class="ok-empty">Tutto in ordine: nessuna prenotazione passata senza contatore.</p>';
            return;
        }

        const shown = past.slice(0, 30);
        let html = '<table class="consecutive-table"><thead><tr><th>Data</th><th>Orario</th><th>Socio</th><th>Manca</th></tr></thead><tbody>';
        shown.forEach(r => {
            const dShort = r.dateObj ? r.dateObj.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '-';
            const dFull = r.dateObj ? formatDateFull(r.dateObj) : '';
            const orario = (r.ora_inizio && r.ora_fine) ? `${r.ora_inizio}-${r.ora_fine}` : '-';
            const nome = String(r.socio || '');
            const parts = nome.trim().split(/\s+/);
            const nomeShort = parts.length > 1 ? parts[0].charAt(0) + '. ' + parts.slice(1).join(' ') : nome;
            let manca = 'entrambi';
            if (r.hobbs_p !== null && r.hobbs_a === null) manca = 'arrivo';
            else if (r.hobbs_p === null && r.hobbs_a !== null) manca = 'partenza';
            html += `<tr><td class="c-date" title="${dFull}">${dShort}</td><td class="c-time">${orario}</td>` +
                `<td class="c-socio"><span class="nm-full">${nome}</span><span class="nm-short">${nomeShort}</span></td>` +
                `<td class="miss-${manca}">${manca}</td></tr>`;
        });
        html += '</tbody></table>';
        html += `<p class="consecutive-note">${past.length} prenotazion${past.length === 1 ? 'e' : 'i'} da completare` +
                (past.length > shown.length ? ` (mostrate le ${shown.length} più recenti)` : '') +
                '. Alcune potrebbero essere prenotazioni non volate.</p>';
        box.innerHTML = html;
    };

    // --- Ore volate per mese ---
    let monthlyChart = null;
    const renderMonthlyChart = (flights) => {
        const canvas = document.getElementById('monthlyChart');
        if (!canvas || typeof Chart === 'undefined') return;

        const perMese = {};
        flights.forEach(f => {
            if (!f.dateObj) return;
            const k = `${f.dateObj.getFullYear()}-${String(f.dateObj.getMonth() + 1).padStart(2, '0')}`;
            perMese[k] = (perMese[k] || 0) + f.minutes;
        });
        const keys = Object.keys(perMese).sort().slice(-12); // ultimi 12 mesi con voli
        if (keys.length === 0) { canvas.parentElement.style.display = 'none'; return; }
        canvas.parentElement.style.display = '';

        const mesi = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
        const labels = keys.map(k => { const [y, m] = k.split('-'); return `${mesi[+m - 1]} ${y.slice(2)}`; });
        const ore = keys.map(k => +(perMese[k] / 60).toFixed(1));

        if (monthlyChart) { monthlyChart.destroy(); monthlyChart = null; }
        monthlyChart = new Chart(canvas.getContext('2d'), {
            type: 'bar',
            data: {
                labels,
                datasets: [{
                    label: 'Ore volate',
                    data: ore,
                    backgroundColor: 'rgba(30, 58, 138, .75)',
                    hoverBackgroundColor: '#c9a960',
                    borderRadius: 5,
                    maxBarThickness: 38
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: 'rgba(15,23,42,.92)',
                        callbacks: { label: (c) => `${c.parsed.y} ore` }
                    }
                },
                scales: {
                    x: { grid: { display: false }, ticks: { font: { size: 10 }, color: '#64748b' } },
                    y: { beginAtZero: true, ticks: { font: { size: 10 }, color: '#64748b' }, grid: { color: 'rgba(15,23,42,.05)' } }
                }
            }
        });
    };

    // --- Avviso rapido (toast) ---
    let admToastTimer = null;
    const admToast = (msg) => {
        const t = document.getElementById('adm-toast');
        if (!t) { alert(msg); return; }
        t.textContent = msg;
        t.classList.add('is-open');
        clearTimeout(admToastTimer);
        admToastTimer = setTimeout(() => t.classList.remove('is-open'), 2800);
    };

    // --- Prenotazione rapida: tocca l'inizio, poi scegli la durata ---
    let quickStart = null;   // "HH:MM"
    let quickSlots = 1;      // numero di fasce da 30 minuti

    const addMin = (t, n) => {
        const [h, m] = t.split(':').map(Number);
        const tot = h * 60 + m + n;
        return String(Math.floor(tot / 60) % 24).padStart(2, '0') + ':' + String(tot % 60).padStart(2, '0');
    };
    const slotEl = (t) => document.querySelector(`.half-hour-slot[data-slot-time="${t}"]`);

    // Una durata è possibile solo se tutte le fasce che occupa sono libere
    const quickFits = (start, n) => {
        for (let k = 0; k < n; k++) {
            const el = slotEl(addMin(start, k * 30));
            if (!el || !el.classList.contains('free')) return false;
        }
        return true;
    };

    const clearQuickBooking = () => {
        quickStart = null; quickSlots = 1;
        document.querySelectorAll('.slot-start-tag').forEach(e => e.remove());
        document.querySelectorAll('.half-hour-slot.slot-start, .half-hour-slot.slot-inrange')
            .forEach(el => el.classList.remove('slot-start', 'slot-inrange'));
        const bar = document.getElementById('quick-book-bar');
        if (bar) bar.classList.remove('is-open');
    };

    const refreshQuickBar = () => {
        const bar = document.getElementById('quick-book-bar');
        const durWrap = document.getElementById('qb-durations');
        const rangeEl = document.getElementById('qb-range');
        if (!bar || !durWrap || !rangeEl) return;

        document.querySelectorAll('.slot-start-tag').forEach(e => e.remove());
        document.querySelectorAll('.half-hour-slot.slot-start, .half-hour-slot.slot-inrange')
            .forEach(el => el.classList.remove('slot-start', 'slot-inrange'));

        if (!quickStart) { bar.classList.remove('is-open'); return; }

        // Evidenzia le fasce scelte
        for (let k = 0; k < quickSlots; k++) {
            const el = slotEl(addMin(quickStart, k * 30));
            if (el) el.classList.add(k === 0 ? 'slot-start' : 'slot-inrange');
        }
        const startEl = slotEl(quickStart);
        if (startEl) {
            const content = startEl.querySelector('.slot-content');
            if (content) content.insertAdjacentHTML('afterbegin', '<span class="slot-start-tag">Inizio</span>');
        }

        // Durate disponibili
        durWrap.innerHTML = '';
        [[1, '30 min'], [2, '1 ora'], [3, '1h 30'], [4, '2 ore']].forEach(([n, label]) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'qb-dur';
            b.textContent = label;
            b.setAttribute('aria-pressed', quickSlots === n ? 'true' : 'false');
            b.disabled = !quickFits(quickStart, n);
            b.addEventListener('click', () => { quickSlots = n; refreshQuickBar(); });
            durWrap.appendChild(b);
        });

        rangeEl.textContent = `${quickStart} → ${addMin(quickStart, quickSlots * 30)}`;
        bar.classList.add('is-open');
    };

    const startQuickBooking = (slotTime) => {
        quickStart = slotTime;
        quickSlots = 1;
        refreshQuickBar();
    };

    // ===============================================================
    //  TRASFERTE — l'aereo è assente dal campo per una finestra lunga
    //  (parte, resta via, rientra). Una sola prenotazione continua,
    //  anche a cavallo di più giorni. Chi rientra prima può chiuderla.
    // ===============================================================
    let trasferteAttive = [];
    let trasferteUnsub = null;
    let ultimeBookingsGiorno = [];

    // Finestra [inizio, fine] di una trasferta come date complete
    const finestraTrasferta = (t) => {
        const inizio = bookingDateToDate(t.data);
        const fine = bookingDateToDate(t.data_fine || t.data);
        if (!inizio || !fine) return null;
        const [ih, im] = (t.ora_inizio || '00:00').split(':').map(Number);
        const [fh, fm] = (t.ora_fine || '23:59').split(':').map(Number);
        inizio.setHours(ih, im, 0, 0);
        fine.setHours(fh, fm, 0, 0);
        return { inizio, fine };
    };

    // Trasferta che occupa una certa fascia oraria (o null)
    const trasfertaPerFascia = (slotStart, slotEnd) => {
        for (const t of trasferteAttive) {
            const w = finestraTrasferta(t);
            if (w && w.inizio < slotEnd && w.fine > slotStart) return t;
        }
        return null;
    };

    // Ascolta tutte le trasferte (sono poche): servono anche nei giorni intermedi
    const listenToTrasferte = () => {
        if (trasferteUnsub) trasferteUnsub();
        trasferteUnsub = db.collection('bookings')
            .where('tipo', '==', 'trasferta')
            .onSnapshot(async (snapshot) => {
                const lista = [];
                for (const doc of snapshot.docs) {
                    const t = { id: doc.id, ...doc.data() };
                    if (t.socio_id) {
                        try {
                            const u = await db.collection('users').doc(t.socio_id).get();
                            if (u.exists) {
                                const d = u.data();
                                t.socio_nome = (d.nome && d.cognome) ? `${d.nome} ${d.cognome}` : d.email;
                            }
                        } catch (e) { console.warn('nome socio trasferta:', e); }
                    }
                    lista.push(t);
                }
                trasferteAttive = lista;
                // ridisegna la giornata mostrata, così le trasferte compaiono subito
                renderHourlySchedule(ultimeBookingsGiorno);
            }, (err) => console.warn('Trasferte non caricate:', err));
    };

    // Chiude in anticipo una trasferta: l'aereo è rientrato, le ore dopo tornano libere
    const chiudiTrasferta = async (bookingId) => {
        const ora = new Date();
        // arrotonda alla mezz'ora successiva, così la fascia in corso resta occupata
        ora.setMinutes(ora.getMinutes() > 30 ? 60 : 30, 0, 0);
        const giorno = new Date(ora); giorno.setHours(0, 0, 0, 0);
        const oraFine = `${String(ora.getHours()).padStart(2, '0')}:${String(ora.getMinutes()).padStart(2, '0')}`;
        try {
            await db.collection('bookings').doc(bookingId).update({
                data_fine: firebase.firestore.Timestamp.fromDate(giorno),
                ora_fine: oraFine
            });
            admToast(`Trasferta chiusa: aereo rientrato alle ${oraFine}`);
        } catch (e) {
            console.error('Chiusura trasferta:', e);
            admToast('Non è stato possibile chiudere la trasferta.');
        }
    };

    // --- Generazione Tabella Oraria ---
    const renderHourlySchedule = (allBookings) => {
        allBookings = allBookings || [];
        ultimeBookingsGiorno = allBookings;
        hourlyScheduleDiv.innerHTML = '';
        clearQuickBooking();

        // Individua le prenotazioni che fanno parte di un "volo unico":
        // fasce attaccate dello stesso socio con contatore di partenza e arrivo identici.
        const unifiedBookingIds = new Set();
        (() => {
            const withHobbs = allBookings.filter(b => b.hobbs_partenza && b.hobbs_arrivo && b.ora_inizio && b.ora_fine);
            const grp = {};
            withHobbs.forEach(b => {
                const key = `${b.socio_id}|${parseFloat(b.hobbs_partenza)}|${parseFloat(b.hobbs_arrivo)}`;
                (grp[key] = grp[key] || []).push(b);
            });
            Object.values(grp).forEach(list => {
                if (list.length < 2) return;
                list.sort((a, b) => a.ora_inizio.localeCompare(b.ora_inizio));
                for (let i = 1; i < list.length; i++) {
                    if (list[i - 1].ora_fine === list[i].ora_inizio) {
                        unifiedBookingIds.add(list[i - 1].id);
                        unifiedBookingIds.add(list[i].id);
                    }
                }
            });
        })();

        // Skip hours that are always dark even in summer (0-5 and 22-23)
        for (let hour = 6; hour <= 21; hour++) {
            const hourBlock = document.createElement('div');
            hourBlock.classList.add('hour-block');
            hourBlock.style.animationDelay = Math.min((hour - 6) * 22, 320) + 'ms';

            const timeLabel = document.createElement('div');
            timeLabel.classList.add('time-label');
            timeLabel.textContent = `${String(hour).padStart(2, '0')}:00`;
            hourBlock.appendChild(timeLabel);

            const halfHourSlots = ['00', '30'];

            halfHourSlots.forEach(minute => {
                const slot = document.createElement('div');
                slot.classList.add('half-hour-slot');

                const slotTime = `${String(hour).padStart(2, '0')}:${minute}`;
                slot.dataset.slotTime = slotTime;

                const slotStart = new Date(currentDisplayDate);
                slotStart.setHours(hour, parseInt(minute), 0, 0);

                const slotEnd = new Date(currentDisplayDate);
                slotEnd.setHours(hour, parseInt(minute) + 29, 59, 999);

                // --- Validazione buio ---
                const sunrise = new Date(currentDisplayDate);
                const [srHour, srMinute] = currentDaySunrise.split(':').map(Number);
                sunrise.setHours(srHour, srMinute, 0, 0);

                const sunset = new Date(currentDisplayDate);
                const [ssHour, ssMinute] = currentDaySunset.split(':').map(Number);
                sunset.setHours(ssHour, ssMinute, 0, 0);

                if (slotStart < sunrise || slotEnd > sunset) {
                    slot.classList.add('night');
                    slot.innerHTML = `<div class="slot-content">Buio</div>`;
                    hourBlock.appendChild(slot);
                    return;
                }

                // --- Trasferta: l'aereo è fisicamente altrove ---
                const tras = trasfertaPerFascia(slotStart, slotEnd);
                if (tras) {
                    const w = finestraTrasferta(tras);
                    const nome = tras.socio_nome || 'Socio';
                    const stessoGiorno = w.fine.toDateString() === slotStart.toDateString();
                    const rientro = stessoGiorno
                        ? `rientro ${String(w.fine.getHours()).padStart(2, '0')}:${String(w.fine.getMinutes()).padStart(2, '0')}`
                        : `rientro ${w.fine.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' })} ${String(w.fine.getHours()).padStart(2, '0')}:${String(w.fine.getMinutes()).padStart(2, '0')}`;
                    slot.classList.add('trasferta');
                    slot.innerHTML = `<div class="slot-content"><span class="tras-tag">✈ In trasferta</span>` +
                        `<span class="tras-nome">${nome}</span><span class="tras-rientro">${rientro}</span></div>`;
                    slot.style.cursor = 'pointer';
                    slot.addEventListener('click', () => {
                        const isOwner = window.currentUser && tras.socio_id === window.currentUser.uid;
                        showBookingDetails(tras, isOwner);
                    });
                    hourBlock.appendChild(slot);
                    return;
                }

                // --- Prenotazioni ---
                let bookedInfo = null;
                let bookingIdForSlot = null;
                let socioIdForSlot = null;
                let isBookedByCurrentUser = false;
                let bookingDataForSlot = null;

                for (const booking of allBookings) {
                    const bookingStart = new Date(currentDisplayDate);
                    const [bkStartHour, bkStartMinute] = booking.ora_inizio.split(':').map(Number);
                    bookingStart.setHours(bkStartHour, bkStartMinute, 0, 0);

                    const bookingEnd = new Date(currentDisplayDate);
                    const [bkEndHour, bkEndMinute] = booking.ora_fine.split(':').map(Number);
                    bookingEnd.setHours(bkEndHour, bkEndMinute, 0, 0);

                    if (bookingStart < slotEnd && bookingEnd > slotStart) {
                        bookedInfo = booking.socio_nome || 'Socio Sconosciuto';
                        bookingIdForSlot = booking.id;
                        socioIdForSlot = booking.socio_id;
                        bookingDataForSlot = booking;
                        if (window.currentUser && booking.socio_id === window.currentUser.uid) {
                            isBookedByCurrentUser = true;
                        }
                        break;
                    }
                }

                if (bookedInfo) {
                    slot.classList.add('booked');
                    slot.dataset.bookingId = bookingIdForSlot;
                    slot.dataset.socioId = socioIdForSlot;

                    if (isBookedByCurrentUser) {
                        slot.classList.add('own-booking-slot');
                    }
                    
                    // Build slot content with Hobbs data if available
                    let slotHTML = `<div class="slot-content">${bookedInfo}`;
                    if (unifiedBookingIds.has(bookingIdForSlot)) {
                        slotHTML += `<span class="unified-marker" title="Volo unico: fasce consecutive unite (stesso contatore)">🔗</span>`;
                    }
                    if (bookingDataForSlot && (bookingDataForSlot.hobbs_partenza || bookingDataForSlot.hobbs_arrivo)) {
                        slotHTML += `<div class="hobbs-info">`;
                        if (bookingDataForSlot.hobbs_partenza) {
                            slotHTML += `<span>P: ${bookingDataForSlot.hobbs_partenza}</span>`;
                        }
                        if (bookingDataForSlot.hobbs_arrivo) {
                            slotHTML += `<span>A: ${bookingDataForSlot.hobbs_arrivo}</span>`;
                        }
                        slotHTML += `</div>`;
                    }
                    slotHTML += `</div>`;
                    slot.innerHTML = slotHTML;

                    if (window.currentUser) {
                        slot.style.cursor = 'pointer';
                        
                        // Store booking data for event handlers
                        slot.bookingData = bookingDataForSlot;
                        slot.isOwner = isBookedByCurrentUser;
                        
                        // Simple click - show details dialog
                        slot.addEventListener('click', () => {
                            showBookingDetails(slot.bookingData, slot.isOwner);
                        });
                    }

                } else {
                    slot.classList.add('free');
                    slot.innerHTML = `<div class="slot-content">Libero <span class="slot-time-indicator">(${slotTime})</span></div>`;

                    slot.style.cursor = 'pointer';
                    slot.addEventListener('click', () => {
                        if (!window.currentUser) {
                            admToast("Devi accedere per prenotare.");
                            return;
                        }
                        startQuickBooking(slot.dataset.slotTime);
                    });
                }

                hourBlock.appendChild(slot);
            });

            hourlyScheduleDiv.appendChild(hourBlock);
        }
    };

    // --- Helper Functions for Hobbs Meter ---

    // Converte una differenza Hobbs in ore decimali -> stringa "Xh Ym (N minuti)"
    // Il contaore del P96 è in decimi d'ora: 0.1 = 6 minuti.
    const formatFlightTime = (hobbsP, hobbsA) => {
        const p = parseFloat(hobbsP);
        const a = parseFloat(hobbsA);
        if (isNaN(p) || isNaN(a) || a <= p) return null;
        const decimalHours = a - p;
        const totalMinutes = Math.round(decimalHours * 60);
        const h = Math.floor(totalMinutes / 60);
        const m = totalMinutes % 60;
        const hm = h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
        return { totalMinutes, decimalHours, label: `${hm} (${totalMinutes} minuti)` };
    };

    // Helper: ricava un oggetto Date dal campo "data" (Firestore Timestamp o {seconds})
    const bookingDateToDate = (data) => {
        if (!data) return null;
        if (typeof data.toDate === 'function') return data.toDate();
        if (data.seconds) return new Date(data.seconds * 1000);
        return null;
    };

    // Popola il menù a tendina con le date che hanno prenotazioni (più recenti in alto)
    const populateDateDropdown = (dateMsSet) => {
        const select = document.getElementById('date-jump-select');
        if (!select) return;
        const sorted = Array.from(dateMsSet).sort((a, b) => b - a); // desc
        let html = '<option value="">— Seleziona una data —</option>';
        sorted.forEach(ms => {
            const d = new Date(ms);
            html += `<option value="${ms}">${formatDateFull(d)}</option>`;
        });
        select.innerHTML = html;
    };

    // Disegna la card "Stato Aeromobile" con il livello carburante e il consumo medio.
    // Forbice di consumo plausibile per il Rotax 912 del P96 (L/h).
    // Il P96 ha 70 L e circa 4h30 di autonomia: ~15-17 L/h reali.
    // Le letture a vista del serbatoio sono imprecise: fuori da questa forbice si scartano.
    const CONSUMO_MIN = 8;
    const CONSUMO_MAX = 28;
    const CONSUMO_MIN_VOLI = 3;   // sotto questo numero di letture valide non mostriamo la stima

    const FUEL_TANK_LITERS = 70; // pieno I-6195 (35 + 35 per semiala)
    const renderAircraftStatus = (lastFuel, lastUse, avgConsumption, fuelFlightCount, scartati) => {
        const card = document.getElementById('aircraft-status');
        if (!card) return;

        const hasFuel = (lastFuel !== null && lastFuel !== undefined && !isNaN(lastFuel));
        const hasConsumption = (avgConsumption && avgConsumption > 0 && fuelFlightCount > 0);

        // La card compare sempre; se non c'è ancora alcun dato, mostra uno stato vuoto
        if (!hasFuel && !hasConsumption) {
            const gaugeEl0 = document.querySelector('#aircraft-status .fuel-gauge');
            if (gaugeEl0) gaugeEl0.style.display = 'none';
            const meta0 = document.getElementById('fuel-meta');
            if (meta0) {
                meta0.textContent = "Nessuna lettura carburante registrata finora: comparirà qui quando un socio inserirà il carburante all'arrivo del volo.";
                meta0.style.display = '';
            }
            const cons0 = document.getElementById('fuel-consumption');
            if (cons0) cons0.style.display = 'none';
            card.style.display = '';
            return;
        }

        const gaugeEl = document.querySelector('#aircraft-status .fuel-gauge');
        const meta = document.getElementById('fuel-meta');

        if (hasFuel) {
            const pct = Math.max(0, Math.min(100, (lastFuel / FUEL_TANK_LITERS) * 100));
            const fill = document.getElementById('fuel-gauge-fill');
            if (fill) {
                fill.style.width = pct.toFixed(0) + '%';
                fill.className = 'fuel-gauge-fill ' + (pct > 50 ? 'fuel-high' : (pct >= 25 ? 'fuel-mid' : 'fuel-low'));
            }
            const label = document.getElementById('fuel-gauge-label');
            if (label) {
                const litersTxt = Number.isInteger(lastFuel) ? `${lastFuel}` : lastFuel.toFixed(1);
                label.textContent = `${litersTxt} L / ${FUEL_TANK_LITERS} L (${pct.toFixed(0)}%)`;
            }
            if (gaugeEl) gaugeEl.style.display = '';
            if (meta) {
                let t = 'Ultima lettura';
                if (lastUse && lastUse.dateObj) t += ' del ' + formatDateFull(lastUse.dateObj);
                const esc = (x) => String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                let html = esc(t);
                // Nome e cognome restano sempre uniti: se non ci stanno, vanno a capo insieme
                if (lastUse && lastUse.socio) html += ' · <span class="nowrap">' + esc(lastUse.socio) + '</span>';
                meta.innerHTML = html;
                meta.style.display = '';
            }
        } else {
            // Livello non disponibile: nascondo la barra ma tengo la card per il consumo
            if (gaugeEl) gaugeEl.style.display = 'none';
            if (meta) {
                meta.textContent = 'Livello carburante non disponibile (l\'ultimo volo non l\'ha registrato).';
                meta.style.display = '';
            }
        }

        const cons = document.getElementById('fuel-consumption');
        if (cons) {
            if (hasConsumption) {
                let t = `Consumo stimato: ${avgConsumption.toFixed(1)} L/h (mediana su ${fuelFlightCount} letture valide)`;
                if (hasFuel) {
                    const autonomia = lastFuel / avgConsumption;
                    if (isFinite(autonomia) && autonomia > 0) {
                        const h = Math.floor(autonomia);
                        const m = Math.round((autonomia - h) * 60);
                        t += ` · autonomia indicativa ~${h}h${String(m).padStart(2, '0')}`;
                    }
                }
                if (scartati > 0) t += ` · ${scartati} lettur${scartati === 1 ? 'a scartata' : 'e scartate'} fuori scala`;
                cons.textContent = t;
                cons.style.display = '';
            } else {
                // Poche letture attendibili: meglio non mostrare un numero sbagliato
                cons.textContent = scartati > 0
                    ? `Consumo non stimabile: le letture del carburante finora sono incoerenti (${scartati} scartate).`
                    : 'Consumo non ancora stimabile: servono almeno 3 voli con carburante segnato a partenza e arrivo.';
                cons.style.display = '';
            }
        }

        card.style.display = '';
    };

    // Riepilogo ore volate per socio + cache voli + date disponibili (una sola lettura completa)
    const renderMemberTotals = async () => {
        const container = document.getElementById('member-totals');
        if (!container) return;
        container.innerHTML = '<p>Calcolo in corso...</p>';

        try {
            // Mappa id -> nome socio (una sola lettura della collezione users)
            const usersSnapshot = await db.collection('users').get();
            const userNames = {};
            usersSnapshot.forEach(doc => {
                const u = doc.data();
                userNames[doc.id] = (u.nome && u.cognome) ? `${u.nome} ${u.cognome}` : (u.email || doc.id);
            });

            // Tutte le prenotazioni
            const bookingsSnapshot = await db.collection('bookings').get();
            const totalsBySocio = {}; // socio_id -> { minutes, voli }
            const dateMsSet = new Set();
            memberFlightsCache = {}; // reset cache
            allCompleteFlights = []; // reset registro contatore
            incompleteFlightsCount = 0;

            // Carburante: ultima lettura (per Hobbs più alto) + consumo medio
            let lastUse = null; // { hobbsA, carbA, dateObj, socio }
            const consumiValidi = [];   // litri/ora dei singoli voli, gia' filtrati
            let consumiScartati = 0;

            const nameOf = (id) => userNames[id] || `${id} (utente cancellato)`;

            // FASE 1: raccogli i voli completi e le prenotazioni incomplete
            const rawComplete = []; // voli con entrambi i valori del contatore
            const rawOther = [];    // prenotazioni senza volo completo (per il dettaglio socio)

            bookingsSnapshot.forEach(doc => {
                const b = doc.data();
                if (!b.socio_id) return;

                const dateObj = bookingDateToDate(b.data);
                let dateMs = null;
                if (dateObj) {
                    const midnight = new Date(dateObj);
                    midnight.setHours(0, 0, 0, 0);
                    dateMs = midnight.getTime();
                    dateMsSet.add(dateMs);
                }

                const hpRaw = (b.hobbs_partenza !== undefined && b.hobbs_partenza !== null && b.hobbs_partenza !== '') ? b.hobbs_partenza : null;
                const haRaw = (b.hobbs_arrivo !== undefined && b.hobbs_arrivo !== null && b.hobbs_arrivo !== '') ? b.hobbs_arrivo : null;
                const flight = formatFlightTime(b.hobbs_partenza, b.hobbs_arrivo);

                // --- Carburante ---
                const carbP = (b.carburante_partenza !== undefined && b.carburante_partenza !== null && b.carburante_partenza !== '') ? parseFloat(b.carburante_partenza) : null;
                const carbA = (b.carburante_arrivo !== undefined && b.carburante_arrivo !== null && b.carburante_arrivo !== '') ? parseFloat(b.carburante_arrivo) : null;
                const haNum = haRaw !== null ? parseFloat(haRaw) : null;
                // Ultima lettura = volo con Hobbs di arrivo più alto (ultimo uso reale)
                if (haNum !== null && !isNaN(haNum)) {
                    if (lastUse === null || haNum > lastUse.hobbsA ||
                        (haNum === lastUse.hobbsA && lastUse.carbA === null && carbA !== null)) {
                        lastUse = {
                            hobbsA: haNum,
                            carbA: carbA,
                            dateObj,
                            socio: b.socio_nome || nameOf(b.socio_id)
                        };
                    }
                }
                // Consumo: solo voli con carburante di partenza e arrivo e durata Hobbs valida.
                // Le letture del carburante sono a vista, quindi molto imprecise: teniamo solo
                // i valori dentro una forbice plausibile per il Rotax 912 del P96 (8-28 L/h).
                if (flight && carbP !== null && carbA !== null && carbP > carbA) {
                    const hours = (parseFloat(haRaw) - parseFloat(hpRaw));
                    if (hours > 0.15) { // sotto i 9 minuti la lettura non è significativa
                        const lh = (carbP - carbA) / hours;
                        if (lh >= CONSUMO_MIN && lh <= CONSUMO_MAX) {
                            consumiValidi.push(lh);
                        } else {
                            consumiScartati++;
                        }
                    }
                } else if (flight && carbP !== null && carbA !== null && carbA > carbP) {
                    // Arrivo maggiore della partenza: c'è stato un rifornimento, non è consumo
                    consumiScartati++;
                }

                if (flight) {
                    rawComplete.push({
                        socio_id: b.socio_id,
                        socio: b.socio_nome || nameOf(b.socio_id),
                        dateObj, dateMs,
                        ora_inizio: b.ora_inizio || null,
                        ora_fine: b.ora_fine || null,
                        hp_raw: hpRaw, ha_raw: haRaw,
                        hp: parseFloat(hpRaw), ha: parseFloat(haRaw),
                        minutes: flight.totalMinutes
                    });
                } else {
                    rawOther.push({
                        socio_id: b.socio_id,
                        socio: b.socio_nome || nameOf(b.socio_id),
                        dateObj, dateMs,
                        ora_inizio: b.ora_inizio || null,
                        ora_fine: b.ora_fine || null,
                        hobbs_p: hpRaw, hobbs_a: haRaw
                    });
                    // Esattamente un valore presente = volo incompleto (escluso e contato)
                    if ((hpRaw !== null) !== (haRaw !== null)) incompleteFlightsCount++;
                }
            });

            // FASE 2: unifica le fasce CONSECUTIVE con contatore IDENTICO (stesso socio, stesso giorno).
            // Es. 8:00-8:30 + 8:30-9:00 con stessi valori Hobbs = un solo volo, non due.
            // Contatore diverso => non si unisce (sono due voli veri).
            const groups = {};
            rawComplete.forEach(f => {
                const key = `${f.socio_id}|${f.dateMs}|${f.hp}|${f.ha}`;
                (groups[key] = groups[key] || []).push(f);
            });

            const mergedFlights = [];
            Object.values(groups).forEach(group => {
                if (group.length === 1) {
                    mergedFlights.push({ ...group[0], slotCount: 1 });
                    return;
                }
                // Ordina per ora di inizio e fondi solo i tratti di fasce ATTACCATE
                group.sort((a, b) => (a.ora_inizio || '').localeCompare(b.ora_inizio || ''));
                let run = [group[0]];
                const flush = () => {
                    const first = run[0], last = run[run.length - 1];
                    mergedFlights.push({
                        ...first,
                        ora_inizio: first.ora_inizio,
                        ora_fine: last.ora_fine,
                        slotCount: run.length
                    });
                    run = [];
                };
                for (let i = 1; i < group.length; i++) {
                    const prev = run[run.length - 1];
                    if (prev.ora_fine && group[i].ora_inizio && prev.ora_fine === group[i].ora_inizio) {
                        run.push(group[i]); // fascia attaccata -> stesso volo
                    } else {
                        flush(); run = [group[i]];
                    }
                }
                if (run.length) flush();
            });

            // FASE 3: costruisci totali, registro e dettaglio socio dai voli UNIFICATI
            allCompleteFlights = mergedFlights;

            mergedFlights.forEach(f => {
                if (!totalsBySocio[f.socio_id]) totalsBySocio[f.socio_id] = { minutes: 0, voli: 0 };
                totalsBySocio[f.socio_id].minutes += f.minutes;
                totalsBySocio[f.socio_id].voli += 1;
            });

            const ensureMember = (id) => {
                if (!memberFlightsCache[id]) memberFlightsCache[id] = { nome: nameOf(id), flights: [] };
                return memberFlightsCache[id];
            };
            mergedFlights.forEach(f => {
                ensureMember(f.socio_id).flights.push({
                    dateMs: f.dateMs, dateObj: f.dateObj,
                    ora_inizio: f.ora_inizio, ora_fine: f.ora_fine,
                    hobbs_p: f.hp_raw, hobbs_a: f.ha_raw,
                    minutes: f.minutes
                });
            });
            rawOther.forEach(f => {
                ensureMember(f.socio_id).flights.push({
                    dateMs: f.dateMs, dateObj: f.dateObj,
                    ora_inizio: f.ora_inizio, ora_fine: f.ora_fine,
                    hobbs_p: f.hobbs_p, hobbs_a: f.hobbs_a,
                    minutes: null
                });
            });

            // Popola la tendina delle date
            populateDateDropdown(dateMsSet);

            // Nuove sezioni di Statistiche
            renderMaintenance(mergedFlights);
            renderIncompleteList(rawOther);
            renderMonthlyChart(mergedFlights);

            // Stato aeromobile: carburante ultima lettura + consumo medio
            const lastFuel = (lastUse && lastUse.carbA !== null && lastUse.carbA !== undefined) ? lastUse.carbA : null;
            // Mediana: un singolo dato sbagliato non sposta il risultato, come farebbe la media.
            // Serve un minimo di letture valide, altrimenti non mostriamo nulla.
            let avgConsumption = null;
            if (consumiValidi.length >= CONSUMO_MIN_VOLI) {
                const v = consumiValidi.slice().sort((a, b) => a - b);
                const m = Math.floor(v.length / 2);
                avgConsumption = v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
            }
            renderAircraftStatus(lastFuel, lastUse, avgConsumption, consumiValidi.length, consumiScartati);

            const rows = Object.entries(totalsBySocio)
                .map(([id, data]) => ({
                    id,
                    nome: userNames[id] || `${id} (utente cancellato)`,
                    minutes: data.minutes,
                    voli: data.voli
                }))
                .sort((x, y) => y.minutes - x.minutes);

            if (rows.length === 0) {
                container.innerHTML = '<p>Nessun volo con dati Hobbs registrato finora.</p>';
                return;
            }

            let totalAll = 0;
            let html = '<table class="totals-table"><thead><tr>' +
                '<th>#</th><th>Socio</th><th>Voli</th><th>Ore</th><th>Minuti</th></tr></thead><tbody>';
            rows.forEach((r, i) => {
                totalAll += r.minutes;
                const h = Math.floor(r.minutes / 60);
                const m = r.minutes % 60;
                const hm = `${h}h ${String(m).padStart(2, '0')}m`;
                html += `<tr><td>${i + 1}</td>` +
                    `<td class="socio-name" data-socio-id="${r.id}" title="Vedi tutti i voli">${r.nome}</td>` +
                    `<td>${r.voli}</td><td>${hm}</td><td>${r.minutes}</td></tr>`;
            });
            const hAll = Math.floor(totalAll / 60);
            const mAll = totalAll % 60;
            html += `</tbody><tfoot><tr><td colspan="3"><strong>Totale aeromobile</strong></td>` +
                `<td><strong>${hAll}h ${String(mAll).padStart(2, '0')}m</strong></td>` +
                `<td><strong>${totalAll}</strong></td></tr></tfoot></table>` +
                `<p class="totals-hint">👆 Tocca il nome di un socio per vedere il dettaglio di tutti i suoi voli</p>`;
            container.innerHTML = html;
        } catch (error) {
            console.error('Errore nel calcolo dei totali:', error);
            container.innerHTML = '<p style="color:red;">Errore nel calcolo dei totali: ' + error.message + '</p>';
        }
    };

    // Mostra il dettaglio di tutti i voli di un socio (dalla cache)
    const showMemberFlights = (socioId) => {
        const data = memberFlightsCache[socioId];
        const dialog = document.getElementById('member-flights-dialog');
        const nameSpan = document.getElementById('member-flights-name');
        const content = document.getElementById('member-flights-content');
        if (!dialog || !content) return;

        if (!data || data.flights.length === 0) {
            nameSpan.textContent = data ? data.nome : '';
            content.innerHTML = '<p>Nessun volo registrato per questo socio.</p>';
            dialog.style.display = 'flex';
            return;
        }

        nameSpan.textContent = data.nome;

        // Ordina per data (più recente in alto), poi per ora di inizio
        const flights = data.flights.slice().sort((a, b) => {
            const da = a.dateMs || 0;
            const dbb = b.dateMs || 0;
            if (dbb !== da) return dbb - da;
            return (b.ora_inizio || '').localeCompare(a.ora_inizio || '');
        });

        let totalMinutes = 0;
        let html = '<table class="flights-table"><thead><tr>' +
            '<th>Data</th><th>Orario</th><th>Hobbs Part.</th><th>Hobbs Arr.</th><th>Minuti</th>' +
            '</tr></thead><tbody>';

        flights.forEach(f => {
            const dataLabel = f.dateObj ? formatDateFull(f.dateObj) : '-';
            const orario = (f.ora_inizio && f.ora_fine) ? `${f.ora_inizio} - ${f.ora_fine}` : '-';
            const hp = (f.hobbs_p !== null) ? f.hobbs_p : '-';
            const ha = (f.hobbs_a !== null) ? f.hobbs_a : '-';
            let minLabel = '-';
            if (f.minutes !== null) {
                totalMinutes += f.minutes;
                minLabel = String(f.minutes);
            }
            html += `<tr><td>${dataLabel}</td><td>${orario}</td><td>${hp}</td><td>${ha}</td><td>${minLabel}</td></tr>`;
        });

        const h = Math.floor(totalMinutes / 60);
        const m = totalMinutes % 60;
        html += `</tbody><tfoot><tr><td colspan="4"><strong>Totale</strong></td>` +
            `<td><strong>${totalMinutes} min (${h}h ${String(m).padStart(2, '0')}m)</strong></td></tr></tfoot></table>`;

        content.innerHTML = html;
        dialog.style.display = 'flex';
    };

    // Registro "consecutivo" del contatore: tutti i voli completi in ordine di Hobbs,
    // con righe segnaposto grigie per i buchi e righe rosse per le incongruenze.
    const renderConsecutiveFlights = () => {
        const dialog = document.getElementById('consecutive-flights-dialog');
        const content = document.getElementById('consecutive-flights-content');
        if (!dialog || !content) return;

        if (!allCompleteFlights || allCompleteFlights.length === 0) {
            content.innerHTML = '<p>Nessun volo con contatore completo. Se pensi ce ne siano, premi prima "🔄 Aggiorna totali".</p>';
            dialog.style.display = 'flex';
            return;
        }

        const TOL = 0.05; // tolleranza in ore (i decimi valgono 0.1)

        // Ordina per contatore di partenza crescente; a parità, per data/ora
        const flights = allCompleteFlights.slice().sort((a, b) => {
            if (Math.abs(a.hp - b.hp) > 0.0001) return a.hp - b.hp;
            const da = a.dateMs || 0, dbb = b.dateMs || 0;
            if (da !== dbb) return da - dbb;
            return (a.ora_inizio || '').localeCompare(b.ora_inizio || '');
        });

        let html = '<table class="consecutive-table"><thead><tr>' +
            '<th>Data</th><th>Orario</th><th>Inizio</th><th>Fine</th><th>Min</th><th>Socio</th>' +
            '</tr></thead><tbody>';

        let prev = null;
        let totalMinutes = 0;
        let gapCount = 0;

        flights.forEach(f => {
            if (prev) {
                const diff = f.hp - prev.ha;
                if (diff > TOL) {
                    // Buco tra chiusura precedente e apertura attuale: riga segnaposto grigia
                    gapCount++;
                    const gapMin = Math.round(diff * 60);
                    html += `<tr class="gap-row"><td colspan="6">mancante ${prev.ha_raw} → ${f.hp_raw} · ${diff.toFixed(1)} h (${gapMin} min)</td></tr>`;
                }
            }

            // Data compatta (gg/mm/aa) per stare nello schermo del telefono; per esteso nel tooltip
            const dataShort = f.dateObj ? f.dateObj.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '-';
            const dataFull = f.dateObj ? formatDateFull(f.dateObj) : '';
            const orario = (f.ora_inizio && f.ora_fine) ? `${f.ora_inizio}-${f.ora_fine}` : '-';
            totalMinutes += f.minutes;

            // Incongruenza: apertura minore della chiusura precedente (contatore "all'indietro")
            const isError = prev && (f.hp - prev.ha) < -TOL;
            const rowClass = isError ? ' class="error-row"' : '';
            const warn = isError ? ' ⚠️' : '';

            // Nome intero su schermi larghi, iniziale del nome su telefono: mai spezzato a metà
            const nome = String(f.socio || '');
            const parts = nome.trim().split(/\s+/);
            const nomeShort = parts.length > 1 ? parts[0].charAt(0) + '. ' + parts.slice(1).join(' ') : nome;

            html += `<tr${rowClass}><td class="c-date" title="${dataFull}">${dataShort}</td><td class="c-time">${orario}</td>` +
                `<td>${f.hp_raw}${warn}</td><td>${f.ha_raw}</td><td>${f.minutes}</td>` +
                `<td class="c-socio"><span class="nm-full">${nome}</span><span class="nm-short">${nomeShort}</span></td></tr>`;

            prev = f;
        });

        const h = Math.floor(totalMinutes / 60);
        const m = totalMinutes % 60;
        html += `</tbody><tfoot>` +
            `<tr><td colspan="4"><strong>Totale volato</strong></td>` +
            `<td><strong>${totalMinutes} min</strong></td><td><strong>${h}h ${String(m).padStart(2, '0')}m</strong></td></tr>` +
            `</tfoot></table>`;

        let note = `<p class="consecutive-note">Voli completi in elenco: ${flights.length}`;
        if (gapCount > 0) note += ` · buchi rilevati: ${gapCount}`;
        note += '.</p>';
        if (incompleteFlightsCount > 0) {
            note += `<p class="consecutive-note">${incompleteFlightsCount} ${incompleteFlightsCount === 1 ? 'volo escluso' : 'voli esclusi'} perché senza contatore (un solo valore inserito).</p>`;
        }

        content.innerHTML = html + note;
        dialog.style.display = 'flex';
    };

    // Show booking details dialog (visible to all)
    const showBookingDetails = (booking, isOwner) => {
        const dialog = document.getElementById('booking-details-dialog');
        const dateStr = formatDateFull(currentDisplayDate);
        
        document.getElementById('detail-socio').textContent = booking.socio_nome || 'Socio Sconosciuto';
        document.getElementById('detail-date').textContent = dateStr;
        document.getElementById('detail-time').textContent = `${booking.ora_inizio} - ${booking.ora_fine}`;
        
        const hobbsP = booking.hobbs_partenza;
        const hobbsA = booking.hobbs_arrivo;
        
        document.getElementById('detail-hobbs-partenza').textContent = hobbsP ? hobbsP : 'Non registrato';
        document.getElementById('detail-hobbs-arrivo').textContent = hobbsA ? hobbsA : 'Non registrato';
        
        // Show photos if available
        const partenzaPhotoContainer = document.getElementById('detail-hobbs-partenza-photo-container');
        const arrivoPhotoContainer = document.getElementById('detail-hobbs-arrivo-photo-container');
        
        if (booking.hobbs_partenza_photo_url) {
            document.getElementById('detail-hobbs-partenza-photo').src = booking.hobbs_partenza_photo_url;
            partenzaPhotoContainer.style.display = 'block';
        } else {
            partenzaPhotoContainer.style.display = 'none';
        }
        
        if (booking.hobbs_arrivo_photo_url) {
            document.getElementById('detail-hobbs-arrivo-photo').src = booking.hobbs_arrivo_photo_url;
            arrivoPhotoContainer.style.display = 'block';
        } else {
            arrivoPhotoContainer.style.display = 'none';
        }
        
        const flight = formatFlightTime(hobbsP, hobbsA);
        if (flight) {
            document.getElementById('detail-hobbs-duration').textContent = flight.label;
        } else {
            document.getElementById('detail-hobbs-duration').textContent = '-';
        }

        // Carburante
        const carbP = (booking.carburante_partenza !== undefined && booking.carburante_partenza !== null && booking.carburante_partenza !== '') ? parseFloat(booking.carburante_partenza) : null;
        const carbA = (booking.carburante_arrivo !== undefined && booking.carburante_arrivo !== null && booking.carburante_arrivo !== '') ? parseFloat(booking.carburante_arrivo) : null;
        document.getElementById('detail-carburante-partenza').textContent = (carbP !== null) ? `${carbP} L` : 'Non registrato';
        document.getElementById('detail-carburante-arrivo').textContent = (carbA !== null) ? `${carbA} L` : 'Non registrato';
        const consumoRow = document.getElementById('detail-carburante-consumo-row');
        const consumoSpan = document.getElementById('detail-carburante-consumo');
        if (carbP !== null && carbA !== null && carbP > carbA) {
            consumoSpan.textContent = `${(carbP - carbA).toFixed(1)} L`;
            consumoRow.style.display = '';
        } else {
            consumoRow.style.display = 'none';
        }
        
        // Show/hide action buttons based on ownership or admin role
        const actionButtons = document.getElementById('booking-action-buttons');
        const closeTras = document.getElementById('close-trasferta-from-details');
        if (isOwner || window.currentUserRole === 'admin') {
            actionButtons.style.display = 'flex';
            actionButtons.dataset.bookingId = booking.id;
            actionButtons.dataset.bookingData = JSON.stringify(booking);
            // "Aereo rientrato" solo per le trasferte ancora in corso
            if (closeTras) {
                const w = booking.tipo === 'trasferta' ? finestraTrasferta(booking) : null;
                if (w && w.fine > new Date()) {
                    closeTras.style.display = '';
                    closeTras.dataset.bookingId = booking.id;
                } else {
                    closeTras.style.display = 'none';
                }
            }
        } else {
            actionButtons.style.display = 'none';
            if (closeTras) closeTras.style.display = 'none';
        }
        
        dialog.style.display = 'flex';
    };
    
    // Show Hobbs edit dialog
    const showHobbsEditDialog = (booking) => {
        const dialog = document.getElementById('hobbs-edit-dialog');
        const infoText = `${booking.socio_nome} - ${booking.ora_inizio} - ${booking.ora_fine}`;
        
        document.getElementById('edit-booking-info').textContent = infoText;
        document.getElementById('hobbs-partenza-input').value = booking.hobbs_partenza || '';
        document.getElementById('hobbs-arrivo-input').value = booking.hobbs_arrivo || '';
        const carbPInput = document.getElementById('carburante-partenza-input');
        const carbAInput = document.getElementById('carburante-arrivo-input');
        if (carbPInput) carbPInput.value = (booking.carburante_partenza !== undefined && booking.carburante_partenza !== null) ? booking.carburante_partenza : '';
        if (carbAInput) carbAInput.value = (booking.carburante_arrivo !== undefined && booking.carburante_arrivo !== null) ? booking.carburante_arrivo : '';
        document.getElementById('hobbs-error-message').textContent = '';

        // Riassegnazione del socio: solo per l'amministratore
        const reBox = document.getElementById('admin-reassign');
        const reSel = document.getElementById('admin-reassign-select');
        if (reBox && reSel) {
            if (isAdmin()) {
                if (elencoSoci.length === 0) {
                    caricaElencoSoci().then(() => { reSel.value = booking.socio_id || ''; });
                } else {
                    popolaTendineSoci();
                    reSel.value = booking.socio_id || '';
                }
                reBox.style.display = '';
            } else {
                reBox.style.display = 'none';
            }
        }

        // Clear photo previews
        document.getElementById('hobbs-partenza-photo-preview').innerHTML = '';
        document.getElementById('hobbs-arrivo-photo-preview').innerHTML = '';
        
        // Clear file inputs
        document.getElementById('hobbs-partenza-photo').value = '';
        document.getElementById('hobbs-arrivo-photo').value = '';
        
        // Check if we're within 4 hours of booking end (or if admin)
        const bookingDate = new Date(booking.data.seconds * 1000);
        const [endHour, endMinute] = booking.ora_fine.split(':').map(Number);
        const bookingEndTime = new Date(bookingDate);
        bookingEndTime.setHours(endHour, endMinute, 0, 0);
        
        const now = new Date();
        const fourHoursAfterBooking = new Date(bookingEndTime.getTime() + (4 * 60 * 60 * 1000));
        const canEditPhotos = now <= fourHoursAfterBooking || window.currentUserRole === 'admin';
        
        // Enable/disable photo inputs based on time restriction
        const partenzaPhotoInput = document.getElementById('hobbs-partenza-photo');
        const arrivoPhotoInput = document.getElementById('hobbs-arrivo-photo');
        
        partenzaPhotoInput.disabled = !canEditPhotos;
        arrivoPhotoInput.disabled = !canEditPhotos;
        
        // Show existing photos if available
        if (booking.hobbs_partenza_photo_url) {
            const img = document.createElement('img');
            img.src = booking.hobbs_partenza_photo_url;
            img.classList.add('zoomable');
            document.getElementById('hobbs-partenza-photo-preview').appendChild(img);
        }
        
        if (booking.hobbs_arrivo_photo_url) {
            const img = document.createElement('img');
            img.src = booking.hobbs_arrivo_photo_url;
            img.classList.add('zoomable');
            document.getElementById('hobbs-arrivo-photo-preview').appendChild(img);
        }
        
        // Store booking ID and data for saving
        dialog.dataset.bookingId = booking.id;
        dialog.dataset.bookingData = JSON.stringify(booking);
        
        dialog.style.display = 'flex';
    };
    
    // Comprime un'immagine lato client e ne corregge l'orientamento (EXIF).
    // Riduce il lato massimo a maxDim px ed esporta in JPEG. Se qualcosa va storto,
    // restituisce il file originale senza bloccare l'upload.
    const compressImage = async (file, maxDim = 1600, quality = 0.82) => {
        if (!file || !file.type || !file.type.startsWith('image/')) return file;

        const drawToBlob = (source, width, height) => new Promise((resolve) => {
            const scale = Math.min(1, maxDim / Math.max(width, height));
            const w = Math.max(1, Math.round(width * scale));
            const h = Math.max(1, Math.round(height * scale));
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(source, 0, 0, w, h);
            canvas.toBlob((blob) => resolve(blob), 'image/jpeg', quality);
        });

        const toFile = (blob) => {
            try {
                return new File([blob], ((file.name || 'hobbs').replace(/\.[^.]+$/, '')) + '.jpg', { type: 'image/jpeg' });
            } catch (e) {
                return blob; // se File non è costruibile, il Blob va comunque bene per l'upload
            }
        };

        // Percorso preferito: createImageBitmap con orientamento da EXIF
        try {
            if (typeof createImageBitmap === 'function') {
                let bitmap;
                try {
                    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
                } catch (e) {
                    bitmap = await createImageBitmap(file); // alcuni browser ignorano le opzioni
                }
                const blob = await drawToBlob(bitmap, bitmap.width, bitmap.height);
                if (bitmap.close) bitmap.close();
                if (blob && blob.size < file.size) return toFile(blob);
                return file;
            }
        } catch (e) {
            console.warn('Compressione (createImageBitmap) non riuscita, uso fallback:', e);
        }

        // Fallback: Image + canvas (orientamento gestito dal browser)
        try {
            const dataUrl = await new Promise((resolve, reject) => {
                const r = new FileReader();
                r.onload = () => resolve(r.result);
                r.onerror = reject;
                r.readAsDataURL(file);
            });
            const img = await new Promise((resolve, reject) => {
                const image = new Image();
                image.onload = () => resolve(image);
                image.onerror = reject;
                image.src = dataUrl;
            });
            const blob = await drawToBlob(img, img.naturalWidth, img.naturalHeight);
            if (blob && blob.size < file.size) return toFile(blob);
        } catch (e) {
            console.warn('Compressione (fallback) non riuscita, invio originale:', e);
        }
        return file;
    };

    // Helper function to upload photo to ImgBB
    const uploadPhoto = async (file, bookingId, photoType) => {
        if (!file) return null;
        
        try {
            // Comprimi e correggi orientamento prima dell'upload
            file = await compressImage(file);

            // Convert file to base64
            const reader = new FileReader();
            const base64Promise = new Promise((resolve, reject) => {
                reader.onload = () => {
                    const base64String = reader.result.split(',')[1];
                    resolve(base64String);
                };
                reader.onerror = reject;
                reader.readAsDataURL(file);
            });
            
            const base64Image = await base64Promise;
            
            // Create FormData for ImgBB API
            const formData = new FormData();
            formData.append('key', IMGBB_API_KEY);
            formData.append('image', base64Image);
            formData.append('name', `${bookingId}_${photoType}_${Date.now()}`);
            
            // Upload to ImgBB
            const response = await fetch('https://api.imgbb.com/1/upload', {
                method: 'POST',
                body: formData
            });
            
            if (!response.ok) {
                throw new Error('Errore upload ImgBB');
            }
            
            const data = await response.json();
            
            if (!data.success) {
                throw new Error('Upload ImgBB fallito');
            }
            
            // Return the direct link to the image
            return data.data.url;
            
        } catch (error) {
            console.error('Errore upload foto su ImgBB:', error);
            throw error;
        }
    };
    
    // Helper function to find consecutive bookings
    const findConsecutiveBookings = async (currentBooking) => {
        const bookingDate = currentBooking.data;
        // Usa il PROPRIETARIO della prenotazione, non l'utente loggato:
        // così funziona anche quando l'admin modifica la prenotazione di un altro socio.
        const userId = currentBooking.socio_id;
        if (!userId || !bookingDate) return [];

        // Query bookings for the same date and owner
        const snapshot = await db.collection('bookings')
            .where('data', '==', bookingDate)
            .where('socio_id', '==', userId)
            .get();
        
        if (snapshot.empty) return [];
        
        // Sort bookings by start time (gestendo eventuali orari mancanti)
        const bookings = [];
        snapshot.forEach(doc => {
            bookings.push({ id: doc.id, ...doc.data() });
        });
        bookings.sort((a, b) => (a.ora_inizio || '').localeCompare(b.ora_inizio || ''));
        
        // Find consecutive group
        const consecutiveGroup = [currentBooking];
        const currentIndex = bookings.findIndex(b => b.id === currentBooking.id);

        // Se la prenotazione non è tra i risultati, niente catena consecutiva (evita bookings[-1])
        if (currentIndex === -1) return [];
        
        // Look forward
        for (let i = currentIndex + 1; i < bookings.length; i++) {
            const prevEnd = bookings[i-1].ora_fine;
            const currStart = bookings[i].ora_inizio;
            if (prevEnd && currStart && prevEnd === currStart) {
                consecutiveGroup.push(bookings[i]);
            } else {
                break;
            }
        }
        
        // Look backward
        for (let i = currentIndex - 1; i >= 0; i--) {
            const currEnd = bookings[i].ora_fine;
            const nextStart = bookings[i+1].ora_inizio;
            if (currEnd && nextStart && currEnd === nextStart) {
                consecutiveGroup.unshift(bookings[i]);
            } else {
                break;
            }
        }
        
        return consecutiveGroup.length > 1 ? consecutiveGroup : [];
    };
    
    // Save Hobbs data
    const saveHobbsData = async () => {
        const dialog = document.getElementById('hobbs-edit-dialog');
        const bookingId = dialog.dataset.bookingId;
        const hobbsP = document.getElementById('hobbs-partenza-input').value;
        const hobbsA = document.getElementById('hobbs-arrivo-input').value;
        const carbPField = document.getElementById('carburante-partenza-input');
        const carbAField = document.getElementById('carburante-arrivo-input');
        const carbP = carbPField ? carbPField.value : '';
        const carbA = carbAField ? carbAField.value : '';
        const errorMsg = document.getElementById('hobbs-error-message');
        
        const partenzaPhotoFile = document.getElementById('hobbs-partenza-photo').files[0];
        const arrivoPhotoFile = document.getElementById('hobbs-arrivo-photo').files[0];
        
        errorMsg.textContent = '';
        
        // Check if user is authenticated
        if (!window.currentUser) {
            errorMsg.textContent = 'Devi essere autenticato per salvare i dati';
            return;
        }
        
        // Validation
        if (hobbsP && hobbsA) {
            const p = parseFloat(hobbsP);
            const a = parseFloat(hobbsA);
            if (a <= p) {
                errorMsg.textContent = 'Hobbs Arrivo deve essere maggiore di Hobbs Partenza';
                return;
            }
        }

        // Validazione carburante (0-70 litri, facoltativo)
        for (const [val, label] of [[carbP, 'partenza'], [carbA, 'arrivo']]) {
            if (val !== '' && val !== null && val !== undefined) {
                const n = parseFloat(val);
                if (isNaN(n) || n < 0 || n > 70) {
                    errorMsg.textContent = `Carburante ${label}: inserisci un valore tra 0 e 70 litri`;
                    return;
                }
            }
        }
        
        try {
            errorMsg.textContent = 'Salvataggio in corso...';
            
            // First, verify the booking belongs to the current user
            const bookingDoc = await db.collection('bookings').doc(bookingId).get();
            
            if (!bookingDoc.exists) {
                errorMsg.textContent = 'Prenotazione non trovata';
                return;
            }
            
            const bookingData = { id: bookingId, ...bookingDoc.data() };
            
            // Check if user owns this booking or is admin
            if (bookingData.socio_id !== window.currentUser.uid && window.currentUserRole !== 'admin') {
                errorMsg.textContent = 'Non hai i permessi per modificare questa prenotazione';
                return;
            }
            
            // Upload photos if provided
            let partenzaPhotoURL = bookingData.hobbs_partenza_photo_url || null;
            let arrivoPhotoURL = bookingData.hobbs_arrivo_photo_url || null;
            
            if (partenzaPhotoFile) {
                partenzaPhotoURL = await uploadPhoto(partenzaPhotoFile, bookingId, 'partenza');
            }
            
            if (arrivoPhotoFile) {
                arrivoPhotoURL = await uploadPhoto(arrivoPhotoFile, bookingId, 'arrivo');
            }
            
            // Check for consecutive bookings
            const consecutiveBookings = await findConsecutiveBookings(bookingData);
            
            let applyToAll = false;
            if (consecutiveBookings.length > 0) {
                const timeRange = `${consecutiveBookings[0].ora_inizio} - ${consecutiveBookings[consecutiveBookings.length-1].ora_fine}`;
                applyToAll = confirm(
                    `Hai ${consecutiveBookings.length} prenotazioni consecutive (${timeRange}).\n\n` +
                    `Vuoi applicare questi dati Hobbs a tutte le prenotazioni consecutive?`
                );
            }
            
            // Prepare update data
            const updateData = {
                hobbs_partenza: hobbsP || null,
                hobbs_arrivo: hobbsA || null,
                hobbs_partenza_photo_url: partenzaPhotoURL,
                hobbs_arrivo_photo_url: arrivoPhotoURL,
                carburante_partenza: (carbP !== '' && carbP !== null && carbP !== undefined) ? parseFloat(carbP) : null,
                carburante_arrivo: (carbA !== '' && carbA !== null && carbA !== undefined) ? parseFloat(carbA) : null
            };

            // Riassegnazione a un altro socio: solo amministratore
            const reSel = document.getElementById('admin-reassign-select');
            if (isAdmin() && reSel && reSel.value) {
                updateData.socio_id = reSel.value;
            }
            
            // Update the current booking
            await db.collection('bookings').doc(bookingId).update(updateData);
            
            // Update consecutive bookings if user agreed
            if (applyToAll && consecutiveBookings.length > 0) {
                const updatePromises = consecutiveBookings
                    .filter(b => b.id !== bookingId)
                    .map(b => db.collection('bookings').doc(b.id).update(updateData));
                
                await Promise.all(updatePromises);
            }
            
            dialog.style.display = 'none';
            renderMemberTotals();
        } catch (error) {
            console.error('Errore Hobbs:', error);
            errorMsg.textContent = 'Errore nel salvataggio: ' + error.message;
        }
    };
    
    // Delete booking
    const deleteBooking = async (bookingId, bookingInfo, bookingData) => {
        // Verifica se la prenotazione è in una data passata
        const bookingDate = new Date(bookingData.data.seconds * 1000);
        bookingDate.setHours(0, 0, 0, 0);
        
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        if (bookingDate < today && window.currentUserRole !== 'admin') {
            alert('Non è possibile eliminare prenotazioni di date passate. Solo l\'amministratore può farlo.');
            return;
        }
        
        const confirmMsg = `Vuoi eliminare la prenotazione di ${bookingInfo}?`;
        
        if (confirm(confirmMsg)) {
            try {
                await db.collection('bookings').doc(bookingId).delete();
                document.getElementById('booking-details-dialog').style.display = 'none';
            } catch (error) {
                alert('Errore nell\'eliminazione: ' + error.message);
            }
        }
    };
    
    // Setup dialog event listeners
    const setupDialogListeners = () => {
        // Lightbox: apri foto a schermo intero al click su un'immagine .zoomable
        const lightbox = document.getElementById('photo-lightbox');
        const lightboxImg = document.getElementById('lightbox-img');
        const openLightbox = (src) => {
            if (!src || !lightbox || !lightboxImg) return;
            lightboxImg.src = src;
            lightbox.style.display = 'flex';
        };
        const closeLightbox = () => {
            if (!lightbox) return;
            lightbox.style.display = 'none';
            lightboxImg.removeAttribute('src');
        };
        document.addEventListener('click', (e) => {
            const img = e.target.closest && e.target.closest('img.zoomable');
            if (img && img.src) {
                e.stopPropagation();
                openLightbox(img.src);
            }
        });
        if (lightbox) {
            lightbox.addEventListener('click', closeLightbox);
            const lbClose = lightbox.querySelector('.lightbox-close');
            if (lbClose) lbClose.addEventListener('click', closeLightbox);
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && lightbox.style.display === 'flex') closeLightbox();
            });
        }

        // Close buttons
        document.querySelectorAll('.close-button').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.target.closest('.modal').style.display = 'none';
            });
        });
        
        // Close on outside click
        document.querySelectorAll('.modal').forEach(modal => {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    modal.style.display = 'none';
                }
            });
        });
        
        // Edit Hobbs button in details dialog
        document.getElementById('edit-hobbs-from-details').addEventListener('click', () => {
            const actionButtons = document.getElementById('booking-action-buttons');
            const bookingData = JSON.parse(actionButtons.dataset.bookingData);
            document.getElementById('booking-details-dialog').style.display = 'none';
            showHobbsEditDialog(bookingData);
        });
        
        // Delete button in details dialog
        document.getElementById('delete-from-details').addEventListener('click', () => {
            const actionButtons = document.getElementById('booking-action-buttons');
            const bookingId = actionButtons.dataset.bookingId;
            const bookingData = JSON.parse(actionButtons.dataset.bookingData);
            const bookingInfo = `${bookingData.socio_nome} (${bookingData.ora_inizio} - ${bookingData.ora_fine})`;
            deleteBooking(bookingId, bookingInfo, bookingData);
        });
        
        // Hobbs edit dialog buttons
        document.getElementById('save-hobbs-button').addEventListener('click', saveHobbsData);
        document.getElementById('cancel-hobbs-button').addEventListener('click', () => {
            document.getElementById('hobbs-edit-dialog').style.display = 'none';
        });
        
        // Photo preview handlers
        document.getElementById('hobbs-partenza-photo').addEventListener('change', (e) => {
            const file = e.target.files[0];
            const preview = document.getElementById('hobbs-partenza-photo-preview');
            
            if (file && file.type.startsWith('image/')) {
                const reader = new FileReader();
                reader.onload = (event) => {
                    preview.innerHTML = `<img class="zoomable" src="${event.target.result}" alt="Preview Partenza">`;
                };
                reader.readAsDataURL(file);
            }
        });
        
        document.getElementById('hobbs-arrivo-photo').addEventListener('change', (e) => {
            const file = e.target.files[0];
            const preview = document.getElementById('hobbs-arrivo-photo-preview');
            
            if (file && file.type.startsWith('image/')) {
                const reader = new FileReader();
                reader.onload = (event) => {
                    preview.innerHTML = `<img class="zoomable" src="${event.target.result}" alt="Preview Arrivo">`;
                };
                reader.readAsDataURL(file);
            }
        });
    };
    
    // Initialize dialog listeners
    setupDialogListeners();

    // --- METEO + DA (WeatherAPI) ---
    let meteoChart = null;

    const loadWeatherData = async () => {
        const formattedDate = currentDisplayDate.toISOString().split('T')[0];

        mSunrise.textContent = "…";
        mSunset.textContent = "…";
        mTemp.textContent = "…";
        mWind.textContent = "…";
        mQnh.textContent = "…";
        mDa.textContent = "…";

        // --- Alba e tramonto ---
        try {
            const response = await fetch(`https://api.sunrise-sunset.org/json?lat=${CELANO_LAT}&lng=${CELANO_LNG}&date=${formattedDate}&formatted=0`);
            const data = await response.json();

            if (data.status === 'OK') {
                const sunriseUTC = new Date(data.results.sunrise);
                const sunsetUTC = new Date(data.results.sunset);

                currentDaySunrise = sunriseUTC.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
                currentDaySunset = sunsetUTC.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });

                mSunrise.textContent = currentDaySunrise;
                mSunset.textContent = currentDaySunset;
            }
        } catch (err) {
            mSunrise.textContent = "N/D";
            mSunset.textContent = "N/D";
        }

        // --- METEO WeatherAPI ---
        try {
            const key = "560c2e928ac34d779ae64228253112";
            // Request 3 days to get forecast data for future days
            const url = `https://api.weatherapi.com/v1/forecast.json?key=${key}&q=${CELANO_LAT},${CELANO_LNG}&days=3&aqi=no&alerts=no`;

            const res = await fetch(url);
            const meteoData = await res.json();

            const temp = meteoData.current.temp_c;
            const windSpeed = meteoData.current.wind_kph / 1.852;
            const windDir = meteoData.current.wind_degree;
            const pressure = meteoData.current.pressure_mb;

            mTemp.textContent = `${Math.round(temp)}°C`;
            mWind.textContent = `${windSpeed.toFixed(0)} kt ${degToCompass(windDir)}`;
            mQnh.textContent = `${Math.round(pressure)} hPa`;

            // --- Density Altitude ---
            const elevationFt = 2200;
            const PA = elevationFt + (1013.25 - pressure) * 30;
            const T_ISA = 15 - 1.98 * (elevationFt / 1000);
            const DA = Math.round(PA + 120 * (temp - T_ISA));

            mDa.textContent = `${DA} ft`;
            daCell.classList.remove('da-status-ok', 'da-status-warn', 'da-status-high');
            daCell.classList.add(DA > 4000 ? 'da-status-high' : (DA > 3000 ? 'da-status-warn' : 'da-status-ok'));

            // --- Vento sulla pista 08/26 ---
            const gustKt = meteoData.current.gust_kph ? meteoData.current.gust_kph / 1.852 : null;
            renderRunwayWind(windSpeed, windDir, gustKt);

            // --- Render Charts ---
            renderWeatherCharts(meteoData, currentDisplayDate);

        } catch (err) {
            console.error('Errore caricamento meteo:', err);
            mTemp.textContent = "N/D";
            mWind.textContent = "N/D";
            mQnh.textContent = "N/D";
            mDa.textContent = "N/D";
        }
    };

    const renderWeatherCharts = (meteoData, selectedDate) => {
        const canvas = document.getElementById('meteoChartLiah');
        if (!canvas || typeof Chart === 'undefined') return;

        // Ora locale del campo (per la linea "ORA")
        const locationLocaltime = new Date(meteoData.location.localtime);
        const currentHour = locationLocaltime.getHours();

        // Trova il giorno selezionato nel forecast
        const selDay = new Date(selectedDate);
        selDay.setHours(0, 0, 0, 0);
        const yy = selDay.getFullYear();
        const mm = String(selDay.getMonth() + 1).padStart(2, '0');
        const dd = String(selDay.getDate()).padStart(2, '0');
        const selectedDateStr = `${yy}-${mm}-${dd}`;

        const days = meteoData.forecast.forecastday;
        let dayData = null;
        for (let i = 0; i < days.length; i++) {
            if (days[i].date === selectedDateStr) { dayData = days[i]; break; }
        }
        if (!dayData) {
            dayData = (selectedDateStr < days[0].date) ? days[0] : days[days.length - 1];
        }
        const isToday = selectedDateStr === days[0].date;

        const allHours = dayData.hour;
        const labels = allHours.map(h => h.time.split(' ')[1]); // "HH:MM"
        const temps = allHours.map(h => h.temp_c);
        const press = allHours.map(h => h.pressure_mb);

        // Indice dell'ora attuale (linea "ORA"), solo se il giorno mostrato è oggi
        const nowIdx = isToday
            ? allHours.findIndex(h => parseInt(h.time.split(' ')[1].split(':')[0]) === currentHour)
            : -1;

        if (meteoChart) { meteoChart.destroy(); meteoChart = null; }

        // Plugin: linea verticale "ORA"
        const nowLinePlugin = {
            id: 'nowLine',
            afterDraw(chart) {
                if (nowIdx < 0) return;
                const { ctx, chartArea, scales } = chart;
                const xPos = scales.x.getPixelForValue(nowIdx);
                ctx.save();
                ctx.beginPath();
                ctx.moveTo(xPos, chartArea.top);
                ctx.lineTo(xPos, chartArea.bottom);
                ctx.lineWidth = 2;
                ctx.strokeStyle = '#764ba2';
                ctx.setLineDash([4, 4]);
                ctx.stroke();
                ctx.setLineDash([]);
                ctx.fillStyle = '#764ba2';
                ctx.font = "700 10px Barlow, sans-serif";
                ctx.textAlign = 'center';
                const lblX = Math.min(Math.max(xPos, chartArea.left + 18), chartArea.right - 18);
                ctx.fillText('ORA', lblX, chartArea.top + 11);
                ctx.restore();
            }
        };

        const ctx = canvas.getContext('2d');
        meteoChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Temperatura (°C)',
                        data: temps,
                        borderColor: '#dc2626',
                        backgroundColor: 'rgba(220, 38, 38, 0.08)',
                        yAxisID: 'yTemp',
                        tension: 0.35,
                        borderWidth: 2.5,
                        pointRadius: 0,
                        pointHoverRadius: 5,
                        fill: true
                    },
                    {
                        label: 'QNH (hPa)',
                        data: press,
                        borderColor: '#1e3a8a',
                        backgroundColor: 'rgba(30, 58, 138, 0.05)',
                        yAxisID: 'yQnh',
                        tension: 0.35,
                        borderWidth: 2.5,
                        pointRadius: 0,
                        pointHoverRadius: 5,
                        fill: false
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { labels: { usePointStyle: true, padding: 16, font: { size: 12 } } },
                    tooltip: {
                        backgroundColor: 'rgba(15, 23, 42, 0.92)',
                        padding: 10,
                        callbacks: { title: (items) => `Ore ${labels[items[0].dataIndex]}` }
                    }
                },
                scales: {
                    x: {
                        grid: { display: false },
                        ticks: { font: { size: 10 }, maxTicksLimit: 12, autoSkip: true, color: '#64748b' }
                    },
                    yTemp: {
                        type: 'linear',
                        position: 'left',
                        title: { display: true, text: '°C', color: '#dc2626' },
                        ticks: { font: { size: 10 }, color: '#dc2626' },
                        grid: { color: 'rgba(15,23,42,0.04)' }
                    },
                    yQnh: {
                        type: 'linear',
                        position: 'right',
                        title: { display: true, text: 'hPa', color: '#1e3a8a' },
                        ticks: { font: { size: 10 }, color: '#1e3a8a' },
                        grid: { drawOnChartArea: false }
                    }
                }
            },
            plugins: [nowLinePlugin]
        });
    };

    loadWeatherData();
    // --- Ascolta le prenotazioni in tempo reale ---
    const listenToBookings = () => {
        if (bookingsSnapshotUnsubscribe) {
            bookingsSnapshotUnsubscribe();
        }

        const dayStart = new Date(currentDisplayDate);
        dayStart.setHours(0, 0, 0, 0);
        const nextDayStart = new Date(currentDisplayDate);
        nextDayStart.setDate(nextDayStart.getDate() + 1);
        nextDayStart.setHours(0, 0, 0, 0);

        bookingsSnapshotUnsubscribe = db.collection('bookings')
            .where('data', '>=', dayStart)
            .where('data', '<', nextDayStart)
            .orderBy('data', 'asc')
            .onSnapshot(async (snapshot) => {
                // Fetch all user data in parallel for better performance
                const bookingPromises = snapshot.docs.map(async (doc) => {
                    const booking = doc.data();
                    let socio_nome = 'Socio Sconosciuto';

                    if (booking.socio_id) {
                        try {
                            const userDoc = await db.collection('users').doc(booking.socio_id).get();
                            if (userDoc.exists) {
                                const userData = userDoc.data();
                                if (userData.nome && userData.cognome) {
                                    socio_nome = `${userData.nome} ${userData.cognome}`;
                                } else {
                                    socio_nome = userData.email;
                                }
                            } else {
                                socio_nome = `${booking.socio_id} (utente cancellato)`;
                            }
                        } catch (error) {
                            console.warn("Impossibile recuperare il nome del socio:", error);
                        }
                    }

                    return { id: doc.id, socio_nome, ...booking };
                });

                const bookings = await Promise.all(bookingPromises);
                renderHourlySchedule(bookings);
            }, (error) => {
                console.error("Errore nel caricamento delle prenotazioni:", error);
                hourlyScheduleDiv.innerHTML = '<p style="color: red;">Errore nel caricamento delle prenotazioni.</p>';
            });
    };

    // --- Aggiunta prenotazione tramite form ---
    addBookingButton.addEventListener('click', async () => {
        await addBookingLogic(startTimeInput.value, endTimeInput.value);
    });

    // --- Aggiorna totali ore per socio ---
    const refreshTotalsButton = document.getElementById('refresh-totals-button');
    if (refreshTotalsButton) {
        refreshTotalsButton.addEventListener('click', () => {
            renderMemberTotals();
        });
    }

    // --- Schede: Oggi / Statistiche / Strumenti ---
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach(b => b.setAttribute('aria-selected', 'false'));
            btn.setAttribute('aria-selected', 'true');
            document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('is-active'));
            const panel = document.getElementById('tab-' + btn.dataset.tab);
            if (panel) panel.classList.add('is-active');
            if (btn.dataset.tab !== 'oggi') clearQuickBooking();
            // I grafici vivono in schede nascoste: vanno ridimensionati quando compaiono
            if (btn.dataset.tab === 'tools' && meteoChart) {
                setTimeout(() => { try { meteoChart.resize(); } catch (e) { console.warn(e); } }, 80);
            }
            if (btn.dataset.tab === 'stat' && monthlyChart) {
                setTimeout(() => { try { monthlyChart.resize(); } catch (e) { console.warn(e); } }, 80);
            }
        });
    });

    // --- Barra prenotazione rapida: conferma / annulla ---
    const qbConfirm = document.getElementById('qb-confirm');
    const qbCancel = document.getElementById('qb-cancel');
    if (qbCancel) qbCancel.addEventListener('click', () => clearQuickBooking());
    if (qbConfirm) {
        qbConfirm.addEventListener('click', async () => {
            if (!quickStart) return;
            if (!navigator.onLine) {
                admToast('Sei offline: la prenotazione ha bisogno della rete.');
                return;
            }
            const from = quickStart;
            const to = addMin(quickStart, quickSlots * 30);
            qbConfirm.disabled = true;
            try {
                await addBookingLogic(from, to);
                admToast(`Prenotato ${from} → ${to}`);
            } finally {
                qbConfirm.disabled = false;
                clearQuickBooking();
            }
        });
    }

    // --- Selettore socio (amministratore) ---
    const adminSelect = document.getElementById('admin-socio-select');
    if (adminSelect) {
        adminSelect.addEventListener('change', () => {
            aggiornaIndicatorePerConto();
            const id = socioSelezionato();
            if (id) admToast(`Stai prenotando per ${nomeSocio(id)}`);
        });
    }

    // --- Trasferta: apertura modulo, controlli e salvataggio ---
    const trasDialog = document.getElementById('trasferta-dialog');
    const openTrasBtn = document.getElementById('open-trasferta-button');
    if (openTrasBtn && trasDialog) {
        openTrasBtn.addEventListener('click', () => {
            if (!window.currentUser) { admToast('Devi accedere per prenotare.'); return; }
            const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            document.getElementById('tras-data-inizio').value = iso(currentDisplayDate);
            document.getElementById('tras-data-fine').value = iso(currentDisplayDate);
            document.getElementById('tras-error').textContent = '';
            trasDialog.style.display = 'flex';
        });
    }
    const trasCancel = document.getElementById('tras-cancel');
    if (trasCancel) trasCancel.addEventListener('click', () => { trasDialog.style.display = 'none'; });

    const trasSave = document.getElementById('tras-save');
    if (trasSave) {
        trasSave.addEventListener('click', async () => {
            const err = document.getElementById('tras-error');
            err.textContent = '';
            if (!window.currentUser) { err.textContent = 'Devi accedere per prenotare.'; return; }

            const dI = document.getElementById('tras-data-inizio').value;
            const oI = document.getElementById('tras-ora-inizio').value;
            const dF = document.getElementById('tras-data-fine').value;
            const oF = document.getElementById('tras-ora-fine').value;
            if (!dI || !oI || !dF || !oF) { err.textContent = 'Compila giorno e ora di partenza e di rientro.'; return; }

            const inizio = new Date(`${dI}T${oI}:00`);
            const fine = new Date(`${dF}T${oF}:00`);
            if (!(fine > inizio)) { err.textContent = 'Il rientro deve essere successivo alla partenza.'; return; }
            const giorni = (fine - inizio) / 86400000;
            if (giorni > 14) { err.textContent = 'La trasferta non può superare i 14 giorni.'; return; }

            const gInizio = new Date(inizio); gInizio.setHours(0, 0, 0, 0);
            const gFine = new Date(fine); gFine.setHours(0, 0, 0, 0);

            trasSave.disabled = true;
            try {
                // 1) niente sovrapposizioni con altre trasferte
                for (const t of trasferteAttive) {
                    const w = finestraTrasferta(t);
                    if (w && w.inizio < fine && w.fine > inizio) {
                        err.textContent = 'In quel periodo c\'è già una trasferta.';
                        return;
                    }
                }
                // 2) niente sovrapposizioni con prenotazioni normali nel periodo
                const snap = await db.collection('bookings')
                    .where('data', '>=', firebase.firestore.Timestamp.fromDate(gInizio))
                    .where('data', '<=', firebase.firestore.Timestamp.fromDate(gFine))
                    .get();
                for (const doc of snap.docs) {
                    const b = doc.data();
                    if (b.tipo === 'trasferta') continue;
                    const g = bookingDateToDate(b.data);
                    if (!g || !b.ora_inizio || !b.ora_fine) continue;
                    const bs = new Date(g); const [bh, bm] = b.ora_inizio.split(':').map(Number); bs.setHours(bh, bm, 0, 0);
                    const be = new Date(g); const [eh, em] = b.ora_fine.split(':').map(Number); be.setHours(eh, em, 0, 0);
                    if (bs < fine && be > inizio) {
                        err.textContent = `C'è già una prenotazione il ${g.toLocaleDateString('it-IT')} alle ${b.ora_inizio}.`;
                        return;
                    }
                }

                const perContoT = socioSelezionato();
                await db.collection('bookings').add({
                    aeromobile_id: 'Tecnam P96',
                    socio_id: perContoT || window.currentUser.uid,
                    inserita_da: perContoT ? window.currentUser.uid : null,
                    tipo: 'trasferta',
                    data: firebase.firestore.Timestamp.fromDate(gInizio),
                    ora_inizio: oI,
                    data_fine: firebase.firestore.Timestamp.fromDate(gFine),
                    ora_fine: oF,
                    hobbs_partenza: null,
                    hobbs_arrivo: null,
                    stato: 'prenotato',
                    timestamp_creazione: firebase.firestore.FieldValue.serverTimestamp()
                });

                trasDialog.style.display = 'none';
                admToast('Trasferta registrata: l\'aereo risulta assente in quelle ore.');
            } catch (e) {
                console.error('Trasferta:', e);
                err.textContent = 'Errore nel salvataggio: ' + e.message;
            } finally {
                trasSave.disabled = false;
            }
        });
    }

    // --- Chiusura anticipata della trasferta ---
    const closeTrasBtn = document.getElementById('close-trasferta-from-details');
    if (closeTrasBtn) {
        closeTrasBtn.addEventListener('click', async () => {
            const id = closeTrasBtn.dataset.bookingId;
            if (!id) return;
            closeTrasBtn.disabled = true;
            try {
                await chiudiTrasferta(id);
                const dlg = document.getElementById('booking-details-dialog');
                if (dlg) dlg.style.display = 'none';
            } finally {
                closeTrasBtn.disabled = false;
            }
        });
    }

    // --- Apri il registro consecutivo del contatore ---
    const showConsecutiveButton = document.getElementById('show-consecutive-button');
    if (showConsecutiveButton) {
        showConsecutiveButton.addEventListener('click', () => {
            renderConsecutiveFlights();
        });
    }

    // --- Windy: cambio overlay (vento / raffiche / pioggia / nuvole) ---
    const windyFrame = document.getElementById('windy-frame');
    const windyButtons = document.querySelectorAll('.windy-btn');
    if (windyFrame && windyButtons.length) {
        const windySrc = (overlay) =>
            `https://embed.windy.com/embed2.html?lat=42.0517865&lon=13.5574166&detailLat=42.0517865&detailLon=13.5574166&zoom=9&level=surface&overlay=${overlay}&menu=&message=true&marker=true&calendar=now&pressure=&type=map&location=coordinates&detail=&metricWind=kt&metricTemp=default&radarRange=-1`;
        windyButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                const overlay = btn.dataset.overlay || 'wind';
                windyFrame.src = windySrc(overlay);
                windyButtons.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            });
        });
    }

    // --- Click su un nome socio: apre il dettaglio dei suoi voli ---
    const memberTotalsContainer = document.getElementById('member-totals');
    if (memberTotalsContainer) {
        memberTotalsContainer.addEventListener('click', (e) => {
            const cell = e.target.closest('.socio-name');
            if (cell && cell.dataset.socioId) {
                showMemberFlights(cell.dataset.socioId);
            }
        });
    }

    // --- Tendina date: salta a un giorno passato/futuro con prenotazioni ---
    const dateJumpSelect = document.getElementById('date-jump-select');
    if (dateJumpSelect) {
        dateJumpSelect.addEventListener('change', (e) => {
            const val = e.target.value;
            if (!val) return;
            currentDisplayDate = new Date(Number(val));
            currentDisplayDate.setHours(0, 0, 0, 0);
            updateDateDisplay();
            listenToBookings();
            loadWeatherData();
        });
    }

    // --- Gestione UI Authentication ---
    const updateUI = async (user) => {
        if (user) {
            window.currentUser = user; 
            authContainer.style.display = 'none';
            appContent.style.display = 'block';
            authErrorMessage.textContent = '';

            const userRef = db.collection('users').doc(user.uid);
            const docSnapshot = await userRef.get();
            let displayName = user.email;

            // Check if user is admin by email (owner/administrator)
            const isAdminEmail = user.email === 'alessandrofelli@gmail.com';

            if (docSnapshot.exists) {
                const userData = docSnapshot.data();
                // Set admin role if email matches OR if role is set in database
                window.currentUserRole = isAdminEmail ? 'admin' : (userData.ruolo || 'socio');
                
                // If admin email and role not set in database, update it
                if (isAdminEmail && userData.ruolo !== 'admin') {
                    await userRef.update({ ruolo: 'admin' });
                }
                
                if (userData.nome && userData.cognome) {
                    displayName = `${userData.nome} ${userData.cognome}`;
                } else if (userData.nome) {
                    displayName = userData.nome;
                }
                userDisplayNameSpan.textContent = displayName;
            } else {
                userDisplayNameSpan.textContent = user.email;
                // Set admin role if email matches, otherwise default to 'socio'
                window.currentUserRole = isAdminEmail ? 'admin' : 'socio';
                
                // If admin email, create user document with admin role
                if (isAdminEmail) {
                    await userRef.set({
                        email: user.email,
                        ruolo: 'admin',
                        nome: user.email.split('@')[0]
                    });
                }
            }
            
            aggiornaVistaAdmin();
            listenToBookings();
            listenToTrasferte();
            loadWeatherData();
            renderMemberTotals();

        } else {
            window.currentUser = null; 
            window.currentUserRole = null; 
            elencoSoci = [];
            aggiornaVistaAdmin();
            authContainer.style.display = 'block';
            appContent.style.display = 'none';
            userDisplayNameSpan.textContent = '';
            signupNameInput.value = '';
            signupSurnameInput.value = '';
            emailInput.value = '';
            passwordInput.value = '';
            authErrorMessage.textContent = '';

            if (bookingsSnapshotUnsubscribe) {
                bookingsSnapshotUnsubscribe();
            }

            renderHourlySchedule([]);
        }

        // Hide loading message after UI update
        loadingMessage.style.display = 'none';
    };

    auth.onAuthStateChanged((user) => {
        updateUI(user);
    });

    // --- Login ---
    loginButton.addEventListener('click', async () => {
        const email = emailInput.value;
        const password = passwordInput.value;
        authErrorMessage.textContent = '';

        try {
            await auth.signInWithEmailAndPassword(email, password);
        } catch (error) {
            let message = "Errore di accesso.";
            if (error.code === 'auth/wrong-password') message = "Password errata.";
            else if (error.code === 'auth/user-not-found') message = "Utente non trovato.";
            else if (error.code === 'auth/invalid-email') message = "Email non valida.";
            authErrorMessage.textContent = message + " Codice: " + error.code;
        }
    });

    // --- Registrazione ---
    signupButton.addEventListener('click', async () => {
        const email = emailInput.value;
        const password = passwordInput.value;
        const nome = signupNameInput.value.trim();
        const cognome = signupSurnameInput.value.trim();
        authErrorMessage.textContent = '';

        if (!nome || !cognome) {
            authErrorMessage.textContent = "Nome e Cognome sono obbligatori.";
            return;
        }

        try {
            const userCredential = await auth.createUserWithEmailAndPassword(email, password);

            await db.collection('users').doc(userCredential.user.uid).set({
                email: userCredential.user.email,
                nome: nome,
                cognome: cognome,
                ruolo: 'socio',
                creato_il: firebase.firestore.FieldValue.serverTimestamp()
            });

            signupNameInput.value = '';
            signupSurnameInput.value = '';

        } catch (error) {
            let message = "Errore durante la registrazione.";
            if (error.code === 'auth/email-already-in-use') message = "Email già in uso.";
            else if (error.code === 'auth/weak-password') message = "Password troppo debole.";
            else if (error.code === 'auth/invalid-email') message = "Email non valida.";
            authErrorMessage.textContent = message + " Codice: " + error.code;
        }
    });

    // --- Logout ---
    logoutButton.addEventListener('click', async () => {
        try {
            await auth.signOut();
        } catch (error) {
            console.error("Errore durante il logout:", error);
        }
    });

    // --- Reset password ---
    resetPasswordLink.addEventListener('click', async (e) => {
        e.preventDefault();
        const email = emailInput.value;
        if (!email) {
            authErrorMessage.textContent = "Inserisci la tua email.";
            return;
        }
        try {
            await auth.sendPasswordResetEmail(email);
            authErrorMessage.style.color = 'green';
            authErrorMessage.textContent = "Email inviata a " + email;
        } catch (error) {
            authErrorMessage.style.color = 'red';
            authErrorMessage.textContent = "Errore: " + error.message;
        }
    });

    // --- Conversione vento ---
    function degToCompass(num) {
        const val = Math.floor((num / 22.5) + 0.5);
        const arr = ["Nord", "NNE", "NE", "ENE", "Est", "ESE", "SE", "SSE",
                     "Sud", "SSO", "SO", "OSO", "Ovest", "ONO", "NO", "NNO"];
        return arr[(val % 16)];
    }

} catch (error) {
    document.getElementById('app').innerHTML = `
        <h1>Errore nell'inizializzazione dell'applicazione</h1>
        <p>Si è verificato un problema durante il caricamento.</p>
        <p>Controlla la console (F12) per i dettagli.</p>
    `;
}

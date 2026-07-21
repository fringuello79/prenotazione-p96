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

    const sunriseTimeSpan = document.getElementById('sunrise-time');
    const sunsetTimeSpan = document.getElementById('sunset-time');
    const weatherInfoSpan = document.getElementById('weather-info');
    const densityAltitudeSpan = document.getElementById('density-altitude');
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

        if (currentDisplayDate.toDateString() === new Date().toDateString() && newBookingEnd < new Date()) {
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
            await db.collection('bookings').add({
                aeromobile_id: 'Tecnam P96',
                socio_id: window.currentUser.uid,
                data: firebase.firestore.Timestamp.fromDate(bookingDate),
                ora_inizio: startTime,
                ora_fine: endTime,
                hobbs_partenza: null,
                hobbs_arrivo: null,
                stato: 'prenotato',
                timestamp_creazione: firebase.firestore.FieldValue.serverTimestamp()
            });

            bookingErrorMessage.textContent = "";
            if (start === startTimeInput.value && end === endTimeInput.value) {
                startTimeInput.value = "09:00";
                endTimeInput.value = "10:00";
            }
        } catch (error) {
            bookingErrorMessage.textContent = "Errore durante la prenotazione: " + error.message;
        }
    };
    // --- Generazione Tabella Oraria ---
    const renderHourlySchedule = (allBookings) => {
        hourlyScheduleDiv.innerHTML = '';

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
                    slot.addEventListener('click', async () => {
                        if (!window.currentUser) {
                            alert("Devi essere loggato per prenotare.");
                            return;
                        }
                        const clickedSlotTime = slot.dataset.slotTime;
                        
                        const [h, m] = clickedSlotTime.split(':').map(Number);
                        const endDate = new Date(currentDisplayDate);
                        endDate.setHours(h, m + 30, 0, 0);
                        const clickedSlotEnd = `${String(endDate.getHours()).padStart(2, '0')}:${String(endDate.getMinutes()).padStart(2, '0')}`;

                        if (confirm(`Vuoi prenotare dalle ${clickedSlotTime} alle ${clickedSlotEnd}?`)) {
                            await addBookingLogic(clickedSlotTime, clickedSlotEnd);
                        }
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
    const FUEL_TANK_LITERS = 70; // pieno I-6195 (35 + 35 per semiala)
    const renderAircraftStatus = (lastFuel, lastUse, avgConsumption, fuelFlightCount) => {
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
                if (lastUse && lastUse.socio) t += ' · ' + lastUse.socio;
                meta.textContent = t;
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
                let t = `Consumo medio stimato: ${avgConsumption.toFixed(1)} L/h (su ${fuelFlightCount} vol${fuelFlightCount === 1 ? 'o' : 'i'} con dati completi)`;
                if (hasFuel) {
                    const autonomia = lastFuel / avgConsumption;
                    if (isFinite(autonomia) && autonomia > 0) {
                        const h = Math.floor(autonomia);
                        const m = Math.round((autonomia - h) * 60);
                        t += ` · autonomia indicativa ~${h}h${String(m).padStart(2, '0')}`;
                    }
                }
                cons.textContent = t;
                cons.style.display = '';
            } else {
                cons.style.display = 'none';
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
            let fuelConsumedTotal = 0, fuelHoursTotal = 0, fuelFlightCount = 0;

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
                // Consumo: solo voli con carburante di partenza e arrivo e durata Hobbs valida
                if (flight && carbP !== null && carbA !== null && carbP > carbA) {
                    const hours = (parseFloat(haRaw) - parseFloat(hpRaw));
                    if (hours > 0) {
                        fuelConsumedTotal += (carbP - carbA);
                        fuelHoursTotal += hours;
                        fuelFlightCount++;
                    }
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

            // Stato aeromobile: carburante ultima lettura + consumo medio
            const lastFuel = (lastUse && lastUse.carbA !== null && lastUse.carbA !== undefined) ? lastUse.carbA : null;
            const avgConsumption = fuelHoursTotal > 0 ? (fuelConsumedTotal / fuelHoursTotal) : null;
            renderAircraftStatus(lastFuel, lastUse, avgConsumption, fuelFlightCount);

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
            '<th>Giorno</th><th>Orario</th><th>Contatore inizio</th><th>Contatore fine</th><th>Minuti</th><th>Socio</th>' +
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
                    html += `<tr class="gap-row"><td colspan="6">— mancante: da ${prev.ha_raw} a ${f.hp_raw} — ${diff.toFixed(1)} h (${gapMin} min) —</td></tr>`;
                }
            }

            const dataLabel = f.dateObj ? formatDateFull(f.dateObj) : '-';
            const orario = (f.ora_inizio && f.ora_fine) ? `${f.ora_inizio} - ${f.ora_fine}` : '-';
            totalMinutes += f.minutes;

            // Incongruenza: apertura minore della chiusura precedente (contatore "all'indietro")
            const isError = prev && (f.hp - prev.ha) < -TOL;
            const rowClass = isError ? ' class="error-row"' : '';
            const warn = isError ? ' ⚠️' : '';

            html += `<tr${rowClass}><td>${dataLabel}</td><td>${orario}</td>` +
                `<td>${f.hp_raw}${warn}</td><td>${f.ha_raw}</td><td>${f.minutes}</td><td>${f.socio}</td></tr>`;

            prev = f;
        });

        const h = Math.floor(totalMinutes / 60);
        const m = totalMinutes % 60;
        html += `</tbody><tfoot>` +
            `<tr><td colspan="4"><strong>Totale volato (voli completi)</strong></td>` +
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
        if (isOwner || window.currentUserRole === 'admin') {
            actionButtons.style.display = 'flex';
            actionButtons.dataset.bookingId = booking.id;
            actionButtons.dataset.bookingData = JSON.stringify(booking);
        } else {
            actionButtons.style.display = 'none';
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
    let meteoChartForecast = null;

    const loadWeatherData = async () => {
        const formattedDate = currentDisplayDate.toISOString().split('T')[0];

        sunriseTimeSpan.textContent = "Caricamento...";
        sunsetTimeSpan.textContent = "Caricamento...";
        weatherInfoSpan.textContent = "Caricamento...";
        densityAltitudeSpan.textContent = "Caricamento...";

        // --- Alba e tramonto ---
        try {
            const response = await fetch(`https://api.sunrise-sunset.org/json?lat=${CELANO_LAT}&lng=${CELANO_LNG}&date=${formattedDate}&formatted=0`);
            const data = await response.json();

            if (data.status === 'OK') {
                const sunriseUTC = new Date(data.results.sunrise);
                const sunsetUTC = new Date(data.results.sunset);

                currentDaySunrise = sunriseUTC.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
                currentDaySunset = sunsetUTC.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });

                sunriseTimeSpan.textContent = currentDaySunrise;
                sunsetTimeSpan.textContent = currentDaySunset;
            }
        } catch (err) {
            sunriseTimeSpan.textContent = "N/D";
            sunsetTimeSpan.textContent = "N/D";
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

            weatherInfoSpan.textContent =
                `${temp}°C, vento ${windSpeed.toFixed(0)} kt da ${degToCompass(windDir)}, QNH ${pressure} hPa`;

            // --- Density Altitude ---
            const elevationFt = 2200;
            const PA = elevationFt + (1013.25 - pressure) * 30;
            const T_ISA = 15 - 1.98 * (elevationFt / 1000);
            const DA = Math.round(PA + 120 * (temp - T_ISA));

            densityAltitudeSpan.textContent = `${DA}`;
            densityAltitudeSpan.style.color = DA > 3000 ? "red" : "inherit";

            // --- Render Charts ---
            renderWeatherCharts(meteoData, currentDisplayDate);

        } catch (err) {
            console.error('Errore caricamento meteo:', err);
            weatherInfoSpan.textContent = "Errore meteo";
            densityAltitudeSpan.textContent = "N/D";
        }
    };

    const renderWeatherCharts = (meteoData, selectedDate) => {
        // Use location's local time from API for current hour
        const locationLocaltime = new Date(meteoData.location.localtime);
        const currentHour = locationLocaltime.getHours();
        
        // Convert selected date to string format (YYYY-MM-DD) for comparison
        // IMPORTANT: Extract date components in LOCAL timezone, not UTC
        const selectedDay = new Date(selectedDate);
        selectedDay.setHours(0, 0, 0, 0);
        const year = selectedDay.getFullYear();
        const month = String(selectedDay.getMonth() + 1).padStart(2, '0');
        const day = String(selectedDay.getDate()).padStart(2, '0');
        const selectedDateStr = `${year}-${month}-${day}`;
        
        // Find the forecast day that matches the selected date
        // Compare directly with API's date strings to avoid timezone issues
        let dayData = null;
        let dayIndex = -1;
        for (let i = 0; i < meteoData.forecast.forecastday.length; i++) {
            if (meteoData.forecast.forecastday[i].date === selectedDateStr) {
                dayData = meteoData.forecast.forecastday[i];
                dayIndex = i;
                break;
            }
        }
        
        // If selected date not in forecast, determine if it's past or future
        if (!dayData) {
            // Compare selected date string with first forecast day
            if (selectedDateStr < meteoData.forecast.forecastday[0].date) {
                // Past date - use today's data but mark as past
                dayData = meteoData.forecast.forecastday[0];
                dayIndex = -1;
            } else {
                // Future date beyond forecast - use last available day
                dayData = meteoData.forecast.forecastday[meteoData.forecast.forecastday.length - 1];
                dayIndex = meteoData.forecast.forecastday.length;
            }
        }

        const allHours = dayData.hour;
        
        // forecastday[0] is always "today" in the location's timezone
        // Compare selected date string with forecastday[0].date to determine if it's today
        const isToday = selectedDateStr === meteoData.forecast.forecastday[0].date;
        const isFuture = dayIndex > 0;
        const isPast = dayIndex < 0;

        // Destroy existing charts
        if (meteoChart) {
            meteoChart.destroy();
            meteoChart = null;
        }
        if (meteoChartForecast) {
            meteoChartForecast.destroy();
            meteoChartForecast = null;
        }

        if (isToday) {
            // For today: create two side-by-side charts
            // currentHour is already defined at the beginning using location's local time
            
            // Actual data: from start of day to current hour (inclusive)
            // Filter based on actual hour from time string, not array index
            const actualData = allHours.filter(h => {
                const hour = parseInt(h.time.split(" ")[1].split(":")[0]);
                return hour <= currentHour;
            });
            const actualLabels = actualData.map(h => h.time.split(" ")[1]);
            const actualTemps = actualData.map(h => h.temp_c);
            const actualPressures = actualData.map(h => h.pressure_mb);

            // Forecast data: from current hour (exclusive) to end of day
            // Filter based on actual hour from time string, not array index
            const forecastData = allHours.filter(h => {
                const hour = parseInt(h.time.split(" ")[1].split(":")[0]);
                return hour > currentHour;
            });
            const forecastLabels = forecastData.map(h => h.time.split(" ")[1]);
            const forecastTemps = forecastData.map(h => h.temp_c);
            const forecastPressures = forecastData.map(h => h.pressure_mb);

            // Show both chart containers
            document.getElementById('meteoChartActual').style.display = 'block';
            document.getElementById('meteoChartForecast').style.display = 'block';

            // Create actual data chart
            const ctxActual = document.getElementById('meteoChartActual').getContext('2d');
            meteoChart = new Chart(ctxActual, {
                type: 'line',
                data: {
                    labels: actualLabels,
                    datasets: [
                        {
                            label: 'Temperatura (°C)',
                            data: actualTemps,
                            borderColor: 'rgba(255, 0, 0, 1)',
                            backgroundColor: 'rgba(255, 0, 0, 0.1)',
                            yAxisID: 'y1',
                            tension: 0.2,
                            borderWidth: 2,
                            fill: false
                        },
                        {
                            label: 'QNH (hPa)',
                            data: actualPressures,
                            borderColor: 'rgba(0, 0, 255, 1)',
                            backgroundColor: 'rgba(0, 0, 255, 0.1)',
                            yAxisID: 'y2',
                            tension: 0.2,
                            borderWidth: 2,
                            fill: false
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: true,
                    interaction: { mode: 'index', intersect: false },
                    plugins: {
                        title: {
                            display: true,
                            text: 'Dati Reali (fino ad ora)'
                        }
                    },
                    scales: {
                        y1: { 
                            type: 'linear', 
                            position: 'left',
                            title: { display: true, text: 'Temperatura (°C)' }
                        },
                        y2: { 
                            type: 'linear', 
                            position: 'right',
                            title: { display: true, text: 'QNH (hPa)' },
                            grid: { drawOnChartArea: false }
                        }
                    }
                }
            });

            // Create forecast chart
            const ctxForecast = document.getElementById('meteoChartForecast').getContext('2d');
            meteoChartForecast = new Chart(ctxForecast, {
                type: 'line',
                data: {
                    labels: forecastLabels,
                    datasets: [
                        {
                            label: 'Temperatura Prevista (°C)',
                            data: forecastTemps,
                            borderColor: 'rgba(255, 0, 0, 0.5)',
                            backgroundColor: 'rgba(255, 0, 0, 0.1)',
                            yAxisID: 'y1',
                            tension: 0.2,
                            borderWidth: 2,
                            borderDash: [5, 5],
                            fill: false
                        },
                        {
                            label: 'QNH Previsto (hPa)',
                            data: forecastPressures,
                            borderColor: 'rgba(0, 0, 255, 0.5)',
                            backgroundColor: 'rgba(0, 0, 255, 0.1)',
                            yAxisID: 'y2',
                            tension: 0.2,
                            borderWidth: 2,
                            borderDash: [5, 5],
                            fill: false
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: true,
                    interaction: { mode: 'index', intersect: false },
                    plugins: {
                        title: {
                            display: true,
                            text: 'Previsione (da ora a fine giornata)'
                        }
                    },
                    scales: {
                        y1: { 
                            type: 'linear', 
                            position: 'left',
                            title: { display: true, text: 'Temperatura (°C)' }
                        },
                        y2: { 
                            type: 'linear', 
                            position: 'right',
                            title: { display: true, text: 'QNH (hPa)' },
                            grid: { drawOnChartArea: false }
                        }
                    }
                }
            });

        } else if (isPast) {
            // For past days: show all data as actual (solid colors)
            // Note: API doesn't provide real historical data, so this will show forecast data
            document.getElementById('meteoChartActual').style.display = 'block';
            document.getElementById('meteoChartForecast').style.display = 'none';

            const labels = allHours.map(h => h.time.split(" ")[1]);
            const temps = allHours.map(h => h.temp_c);
            const pressures = allHours.map(h => h.pressure_mb);

            const ctxActual = document.getElementById('meteoChartActual').getContext('2d');
            meteoChart = new Chart(ctxActual, {
                type: 'line',
                data: {
                    labels: labels,
                    datasets: [
                        {
                            label: 'Temperatura (°C)',
                            data: temps,
                            borderColor: 'rgba(255, 0, 0, 1)',
                            backgroundColor: 'rgba(255, 0, 0, 0.1)',
                            yAxisID: 'y1',
                            tension: 0.2,
                            borderWidth: 2,
                            fill: false
                        },
                        {
                            label: 'QNH (hPa)',
                            data: pressures,
                            borderColor: 'rgba(0, 0, 255, 1)',
                            backgroundColor: 'rgba(0, 0, 255, 0.1)',
                            yAxisID: 'y2',
                            tension: 0.2,
                            borderWidth: 2,
                            fill: false
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: true,
                    interaction: { mode: 'index', intersect: false },
                    plugins: {
                        title: {
                            display: true,
                            text: 'Dati Giornalieri (Storico non disponibile)'
                        }
                    },
                    scales: {
                        y1: { 
                            type: 'linear', 
                            position: 'left',
                            title: { display: true, text: 'Temperatura (°C)' }
                        },
                        y2: { 
                            type: 'linear', 
                            position: 'right',
                            title: { display: true, text: 'QNH (hPa)' },
                            grid: { drawOnChartArea: false }
                        }
                    }
                }
            });

        } else if (isFuture) {
            // For future days: show all data as forecast (semi-transparent/dashed)
            document.getElementById('meteoChartActual').style.display = 'block';
            document.getElementById('meteoChartForecast').style.display = 'none';

            const labels = allHours.map(h => h.time.split(" ")[1]);
            const temps = allHours.map(h => h.temp_c);
            const pressures = allHours.map(h => h.pressure_mb);

            const ctxActual = document.getElementById('meteoChartActual').getContext('2d');
            meteoChart = new Chart(ctxActual, {
                type: 'line',
                data: {
                    labels: labels,
                    datasets: [
                        {
                            label: 'Temperatura Prevista (°C)',
                            data: temps,
                            borderColor: 'rgba(255, 0, 0, 0.5)',
                            backgroundColor: 'rgba(255, 0, 0, 0.1)',
                            yAxisID: 'y1',
                            tension: 0.2,
                            borderWidth: 2,
                            borderDash: [5, 5],
                            fill: false
                        },
                        {
                            label: 'QNH Previsto (hPa)',
                            data: pressures,
                            borderColor: 'rgba(0, 0, 255, 0.5)',
                            backgroundColor: 'rgba(0, 0, 255, 0.1)',
                            yAxisID: 'y2',
                            tension: 0.2,
                            borderWidth: 2,
                            borderDash: [5, 5],
                            fill: false
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: true,
                    interaction: { mode: 'index', intersect: false },
                    plugins: {
                        title: {
                            display: true,
                            text: 'Previsione Giornaliera'
                        }
                    },
                    scales: {
                        y1: { 
                            type: 'linear', 
                            position: 'left',
                            title: { display: true, text: 'Temperatura (°C)' }
                        },
                        y2: { 
                            type: 'linear', 
                            position: 'right',
                            title: { display: true, text: 'QNH (hPa)' },
                            grid: { drawOnChartArea: false }
                        }
                    }
                }
            });
        }
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
            
            listenToBookings();
            loadWeatherData();
            renderMemberTotals();

        } else {
            window.currentUser = null; 
            window.currentUserRole = null; 
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

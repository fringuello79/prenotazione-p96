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

    // Variabili globali per l'utente e il suo ruolo (accessibili anche dalla console)
    window.currentUser = null; 
    window.currentUserRole = null; 
    let currentDisplayDate = new Date();
    currentDisplayDate.setHours(0, 0, 0, 0);

    let bookingsSnapshotUnsubscribe = null;
    // Variabili per alba e tramonto reali per la data visualizzata
    let currentDaySunrise = "00:00"; 
    let currentDaySunset = "23:59"; 

    // Coordinate per Celano (AQ)
    const CELANO_LAT = 42.0667;
    const CELANO_LNG = 13.5500;
// --- Variabili globali Meteo + DA --- let meteoHours = []; // timestamp orari let meteoTemp = []; // temperatura oraria let meteoPressure = []; // QNH orario let meteoDA = []; // Density Altitude oraria let meteoChart = null; // grafico Chart.js

    // Funzione per formattare la data estesa
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
    
    // --- Funzione per aggiungere prenotazione (helper) ---
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

        // --- VALIDAZIONE ALBA/TRAMONTO CON I DATI REALI ---
        const sunrise = new Date(currentDisplayDate);
        const [srHour, srMinute] = currentDaySunrise.split(':').map(Number);
        sunrise.setHours(srHour, srMinute, 0, 0);

        const sunset = new Date(currentDisplayDate);
        const [ssHour, ssMinute] = currentDaySunset.split(':').map(Number);
        sunset.setHours(ssHour, ssMinute, 0, 0);

        // La prenotazione deve essere interamente all'interno del periodo di luce
        if (newBookingStart < sunrise || newBookingEnd > sunset) {
            bookingErrorMessage.textContent = `Non è possibile prenotare durante le ore di buio (Alba: ${currentDaySunrise}, Tramonto: ${currentDaySunset}).`;
            return;
        }
        // --- FINE VALIDAZIONE ALBA/TRAMONTO ---

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

            if (
                (newBookingStart < existingEnd && newBookingEnd > existingStart)
            ) {
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
            console.log("Prenotazione aggiunta con successo!");
            bookingErrorMessage.textContent = "";
            // Resetta solo i campi del form se la prenotazione è avvenuta tramite form
            if (start === startTimeInput.value && end === endTimeInput.value) {
                startTimeInput.value = "09:00";
                endTimeInput.value = "10:00";
            }
        } catch (error) {
            console.error("Errore nell'aggiungere la prenotazione:", error);
            bookingErrorMessage.textContent = "Errore durante la prenotazione: " + error.message;
        }
    };


    // --- Generazione Tabella Oraria ---
    const renderHourlySchedule = (allBookings) => {
        hourlyScheduleDiv.innerHTML = '';
        const today = new Date();
        const isCurrentDateToday = currentDisplayDate.toDateString() === today.toDateString();


        for (let hour = 0; hour < 24; hour++) {
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

                // --- VALIDAZIONE ORARI DI BUIO PER IL RENDER ---
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
                    return; // Passa allo slot successivo
                }
                // --- FINE VALIDAZIONE ORARI DI BUIO PER IL RENDER ---

                let bookedInfo = null;
                let bookingIdForSlot = null;
                let socioIdForSlot = null;
                let isBookedByCurrentUser = false;

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
                    slot.innerHTML = `<div class="slot-content">${bookedInfo}</div>`;

                    if (window.currentUser && (isBookedByCurrentUser || window.currentUserRole === 'admin')) {
                        slot.style.cursor = 'pointer';
                        slot.addEventListener('click', async () => {
                            const bId = slot.dataset.bookingId;
                            const bookedSocioId = slot.dataset.socioId;

                            let confirmationMessage = `Vuoi annullare la prenotazione di ${bookedInfo} dalle ${slotTime} del ${formatDateFull(currentDisplayDate)}?`;
                            if (window.currentUserRole === 'admin' && window.currentUser.uid !== bookedSocioId) {
                                confirmationMessage = `Sei amministratore. Vuoi annullare la prenotazione di ${bookedInfo} (${slotTime})?`;
                            }

                            if (confirm(confirmationMessage)) {
                                try {
                                    await db.collection('bookings').doc(bId).delete();
                                    alert("Prenotazione annullata con successo!");
                                } catch (error) {
                                    console.error("Errore nell'annullare la prenotazione:", error);
                                    alert("Errore nell'annullare la prenotazione: " + error.message + ". Assicurati di avere i permessi necessari (es. sei l'autore o un admin).");
                                }
                            }
                        });
                    } else {
                        slot.style.cursor = 'default';
                    }

                } else { // Slot Libero
                    slot.classList.add('free');
                    slot.innerHTML = `<div class="slot-content">Libero <span class="slot-time-indicator">(${slotTime})</span></div>`;

                    slot.style.cursor = 'pointer';
                    slot.addEventListener('click', async () => { // Ora async per chiamare addBookingLogic
                        if (!window.currentUser) {
                            alert("Devi essere loggato per prenotare.");
                            return;
                        }
                        const clickedSlotTime = slot.dataset.slotTime;
                        
                        const [h, m] = clickedSlotTime.split(':').map(Number);
                        const endDate = new Date(currentDisplayDate);
                        endDate.setHours(h, m + 30, 0, 0);
                        const clickedSlotEnd = `${String(endDate.getHours()).padStart(2, '0')}:${String(endDate.getMinutes()).padStart(2, '0')}`;

                        if (confirm(`Vuoi prenotare il Tecnam P96 per ${formatDateFull(currentDisplayDate)} dalle ${clickedSlotTime} alle ${clickedSlotEnd}?`)) {
                            await addBookingLogic(clickedSlotTime, clickedSlotEnd); // Prenota direttamente
                        }
                    });
                }
                hourBlock.appendChild(slot);
            });
            hourlyScheduleDiv.appendChild(hourBlock);
        }
    };


 // --- METEO + DA 72h (Open-Meteo) ---
const loadWeatherData = async () => {
    const formattedDate = currentDisplayDate.toISOString().split('T')[0];

    sunriseTimeSpan.textContent = "Caricamento...";
    sunsetTimeSpan.textContent = "Caricamento...";
    weatherInfoSpan.textContent = "Caricamento...";
    densityAltitudeSpan.textContent = "Caricamento...";

    // --- 1. Alba e tramonto ---
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
        } else {
            sunriseTimeSpan.textContent = "N/D";
            sunsetTimeSpan.textContent = "N/D";
        }
    } catch (err) {
        sunriseTimeSpan.textContent = "N/D";
        sunsetTimeSpan.textContent = "N/D";
    }

    // --- 2. Meteo attuale + 72h ---
    try {
        const meteoURL =
            `https://api.open-meteo.com/v1/forecast?latitude=${CELANO_LAT}&longitude=${CELANO_LNG}` +
            `&current=temperature_2m,wind_speed_10m,wind_direction_10m,pressure_msl` +
            `&hourly=temperature_2m,pressure_msl` +
            `&forecast_days=3&timezone=Europe/Rome`;

        const meteoResponse = await fetch(meteoURL);
        const meteoData = await meteoResponse.json();

        // --- METEO ATTUALE ---
        const temp = meteoData.current.temperature_2m;
        const windSpeed = meteoData.current.wind_speed_10m;
        const windDir = meteoData.current.wind_direction_10m;
        const pressure = meteoData.current.pressure_msl;

        weatherInfoSpan.textContent =
            `${temp}°C, vento ${windSpeed} kt da ${degToCompass(windDir)}, QNH ${pressure} hPa`;

        // --- 3. Calcolo DA attuale ---
        const elevationFt = 2820;
        const PA = (1013 - pressure) * 30 + elevationFt;
        const T_ISA = 15 - 2 * (elevationFt / 1000);
        const DA = Math.round(PA + 120 * (temp - T_ISA));

        densityAltitudeSpan.textContent = `${DA} ft`;

        if (DA > 3000) {
            densityAltitudeSpan.style.color = "red";
        } else {
            densityAltitudeSpan.style.color = "inherit";
        }

        // --- 4. Previsioni orarie 72h ---
        meteoHours = meteoData.hourly.time;
        meteoTemp = meteoData.hourly.temperature_2m;
        meteoPressure = meteoData.hourly.pressure_msl;

        // Calcolo DA oraria
        meteoDA = meteoTemp.map((t, i) => {
            const qnh = meteoPressure[i];
            const PAh = (1013 - qnh) * 30 + elevationFt;
            const T_ISAh = 15 - 2 * (elevationFt / 1000);
            return Math.round(PAh + 120 * (t - T_ISAh));
        });

        // --- 5. Aggiorna grafico ---
        updateMeteoChart();

    } catch (err) {
        console.error("Errore meteo:", err);
        weatherInfoSpan.textContent = "Errore meteo";
        densityAltitudeSpan.textContent = "N/D";
    }

    renderHourlySchedule([]);
};

// Prima chiamata
loadWeatherData();

// --- GRAFICO METEO + DA (Chart.js) ---
function updateMeteoChart() {
    const canvas = document.getElementById('meteoChart');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');

    if (meteoChart) {
        meteoChart.destroy();
    }

    meteoChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: meteoHours,
            datasets: [
                {
                    label: 'Temperatura (°C)',
                    data: meteoTemp,
                    borderColor: 'red',
                    yAxisID: 'y1',
                    tension: 0.2
                },
                {
                    label: 'QNH (hPa)',
                    data: meteoPressure,
                    borderColor: 'blue',
                    yAxisID: 'y2',
                    tension: 0.2
                },
                {
                    label: 'Density Altitude (ft)',
                    data: meteoDA,
                    borderColor: 'green',
                    yAxisID: 'y3',
                    tension: 0.2
                }
            ]
        },
        options: {
            responsive: true,
            interaction: { mode: 'index', intersect: false },
            stacked: false,
            scales: {
                y1: { type: 'linear', position: 'left' },
                y2: { type: 'linear', position: 'right' },
                y3: { type: 'linear', position: 'right', grid: { drawOnChartArea: false } }
            }
        }
    });
}


    // Ascolta le modifiche alle prenotazioni in tempo reale per la data selezionata
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
                const bookings = [];
                for (const doc of snapshot.docs) {
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
                    bookings.push({ id: doc.id, socio_nome, ...booking });
                }
                renderHourlySchedule(bookings);
            }, (error) => {
                console.error("Errore nel recuperare le prenotazioni:", error);
                hourlyScheduleDiv.innerHTML = '<p style="color: red;">Errore nel caricamento delle prenotazioni.</p>';
            });
    };


    // Gestione aggiunta nuova prenotazione tramite FORM (riusa addBookingLogic)
    addBookingButton.addEventListener('click', async () => {
        await addBookingLogic(startTimeInput.value, endTimeInput.value);
    });

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

            if (docSnapshot.exists) {
                const userData = docSnapshot.data();
                window.currentUserRole = userData.ruolo || 'socio'; 
                if (userData.nome && userData.cognome) {
                    displayName = `${userData.nome} ${userData.cognome}`;
                } else if (userData.nome) {
                    displayName = userData.nome;
                }
                userDisplayNameSpan.textContent = displayName;
            } else {
                userDisplayNameSpan.textContent = user.email;
                window.currentUserRole = 'socio'; 
            }

            listenToBookings();
            loadWeatherData();

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
        loadingMessage.style.display = 'none';
    };

    auth.onAuthStateChanged((user) => {
        updateUI(user);
    });

    loginButton.addEventListener('click', async () => {
        const email = emailInput.value;
        const password = passwordInput.value;
        authErrorMessage.textContent = '';

        try {
                await auth.signInWithEmailAndPassword(email, password);
                console.log("Accesso effettuato con successo.");
        } catch (error) {
                let message = "Errore di accesso.";
                if (error.code === 'auth/wrong-password') message = "Password errata.";
                else if (error.code === 'auth/user-not-found') message = "Utente non trovato.";
                else if (error.code === 'auth/invalid-email') message = "Email non valida.";
                authErrorMessage.textContent = message + " Codice: " + error.code;
                console.error("Errore di accesso:", error);
        }
    });

    signupButton.addEventListener('click', async () => {
        const email = emailInput.value;
        const password = passwordInput.value;
        const nome = signupNameInput.value.trim();
        const cognome = signupSurnameInput.value.trim();
        authErrorMessage.textContent = '';

        if (!nome || !cognome) {
            authErrorMessage.textContent = "Nome e Cognome sono obbligatori per la registrazione.";
            return;
        }

        try {
            const userCredential = await auth.createUserWithEmailAndPassword(email, password);
            console.log("Utente registrato con successo.");

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
            if (error.code === 'auth/email-already-in-use') message = "Questa email è già in uso.";
            else if (error.code === 'auth/weak-password') message = "La password deve essere di almeno 6 caratteri.";
            else if (error.code === 'auth/invalid-email') message = "Email non valida.";
            authErrorMessage.textContent = message + " Codice: " + error.code;
            console.error("Errore di registrazione:", error);
        }
    });

    logoutButton.addEventListener('click', async () => {
        try {
            await auth.signOut();
            console.log("Logout effettuato con successo.");
        } catch (error) {
            console.error("Errore durante il logout:", error);
        }
    });

    resetPasswordLink.addEventListener('click', async (e) => {
        e.preventDefault();
        const email = emailInput.value;
        if (!email) {
            authErrorMessage.textContent = "Inserisci la tua email per il reset della password.";
            return;
        }
        try {
            await auth.sendPasswordResetEmail(email);
            authErrorMessage.style.color = 'green';
            authErrorMessage.textContent = "Email per il reset della password inviata a " + email + ". Controlla la tua casella di posta.";
        } catch (error) {
            authErrorMessage.textContent = "Errore nell'invio dell'email di reset: " + error.message;
            authErrorMessage.style.color = 'red';
            console.error("Errore reset password:", error);
        }
    });

function degToCompass(num) {
    const val = Math.floor((num / 22.5) + 0.5);
    const arr = ["Nord", "NNE", "NE", "ENE", "Est", "ESE", "SE", "SSE",
                 "Sud", "SSO", "SO", "OSO", "Ovest", "ONO", "NO", "NNO"];
    return arr[(val % 16)];
}

} catch (error) {
    document.getElementById('app').innerHTML = `
        <h1>Errore nell'inizializzazione dell'applicazione</h1>
        <p>Si è verificato un problema grave durante il caricamento di Firebase.</p>
        <p>Controlla la console degli sviluppatori (F12) per i dettagli.</p>
    `;
    console.error("Errore critico nell'inizializzazione di Firebase:", error);
}
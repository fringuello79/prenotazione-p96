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
    const meteoChartTitle = document.getElementById('meteo-chart-title');
    const meteoChartError = document.getElementById('meteo-chart-error');
    const meteoChartDate = document.getElementById('meteo-chart-date');
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
        
        if (hobbsP && hobbsA) {
            const duration = (parseFloat(hobbsA) - parseFloat(hobbsP)).toFixed(1);
            document.getElementById('detail-hobbs-duration').textContent = `${duration} ore`;
        } else {
            document.getElementById('detail-hobbs-duration').textContent = '-';
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
            document.getElementById('hobbs-partenza-photo-preview').appendChild(img);
        }
        
        if (booking.hobbs_arrivo_photo_url) {
            const img = document.createElement('img');
            img.src = booking.hobbs_arrivo_photo_url;
            document.getElementById('hobbs-arrivo-photo-preview').appendChild(img);
        }
        
        // Store booking ID and data for saving
        dialog.dataset.bookingId = booking.id;
        dialog.dataset.bookingData = JSON.stringify(booking);
        
        dialog.style.display = 'flex';
    };
    
    // Helper function to upload photo to ImgBB
    const uploadPhoto = async (file, bookingId, photoType) => {
        if (!file) return null;
        
        try {
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
        const userId = window.currentUser.uid;
        
        // Query bookings for the same date and user
        const snapshot = await db.collection('bookings')
            .where('data', '==', bookingDate)
            .where('socio_id', '==', userId)
            .get();
        
        if (snapshot.empty) return [];
        
        // Sort bookings by start time
        const bookings = [];
        snapshot.forEach(doc => {
            bookings.push({ id: doc.id, ...doc.data() });
        });
        bookings.sort((a, b) => a.ora_inizio.localeCompare(b.ora_inizio));
        
        // Find consecutive group
        const consecutiveGroup = [currentBooking];
        const currentIndex = bookings.findIndex(b => b.id === currentBooking.id);
        
        // Look forward
        for (let i = currentIndex + 1; i < bookings.length; i++) {
            const prevEnd = bookings[i-1].ora_fine;
            const currStart = bookings[i].ora_inizio;
            if (prevEnd === currStart) {
                consecutiveGroup.push(bookings[i]);
            } else {
                break;
            }
        }
        
        // Look backward
        for (let i = currentIndex - 1; i >= 0; i--) {
            const currEnd = bookings[i].ora_fine;
            const nextStart = bookings[i+1].ora_inizio;
            if (currEnd === nextStart) {
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
                hobbs_arrivo_photo_url: arrivoPhotoURL
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
                    preview.innerHTML = `<img src="${event.target.result}" alt="Preview Partenza">`;
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
                    preview.innerHTML = `<img src="${event.target.result}" alt="Preview Arrivo">`;
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
        
        // Update the chart title with the actual date
        const dateForTitle = currentDisplayDate.toLocaleDateString('it-IT', { 
            weekday: 'long', 
            day: 'numeric', 
            month: 'long', 
            year: 'numeric' 
        });
        meteoChartTitle.textContent = `Grafico meteo del ${dateForTitle} e andamento QNH`;

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
            // Add date parameter to get forecast for the specific date
            const url = `https://api.weatherapi.com/v1/forecast.json?key=${key}&q=${CELANO_LAT},${CELANO_LNG}&dt=${formattedDate}&days=1&aqi=no&alerts=no`;

            const res = await fetch(url);
            const meteoData = await res.json();

            // Check if the response contains an error
            if (meteoData.error) {
                throw new Error(`Weather API error: ${meteoData.error.message || 'Unknown error'}`);
            }

            // Validate required data exists
            if (!meteoData.current) {
                throw new Error('Dati meteo correnti non disponibili');
            }
            
            if (!meteoData.forecast || !meteoData.forecast.forecastday || !meteoData.forecast.forecastday[0]) {
                throw new Error('Dati previsione meteo non disponibili');
            }
            
            const forecastDay = meteoData.forecast.forecastday[0];
            
            if (!forecastDay.hour) {
                throw new Error('Dati orari meteo non disponibili');
            }

            const temp = meteoData.current.temp_c;
            const windSpeed = meteoData.current.wind_kph / 1.852;
            const windDir = meteoData.current.wind_degree;
            const pressure = meteoData.current.pressure_mb;

            weatherInfoSpan.textContent =
                `${temp}°C, vento ${windSpeed.toFixed(0)} kt da ${degToCompass(windDir)}, QNH ${pressure} hPa`;

            // --- Density Altitude ---
            const elevationFt = 2820;
            const PA = (1013 - pressure) * 30 + elevationFt;
            const T_ISA = 15 - 2 * (elevationFt / 1000);
            const DA = Math.round(PA + 120 * (temp - T_ISA));

            densityAltitudeSpan.textContent = `${DA} ft`;
            densityAltitudeSpan.style.color = DA > 3000 ? "red" : "inherit";

            // --- Grafico ---
            const forecastHours = forecastDay.hour;
            const hours = forecastHours.map(h => h.time.split(" ")[1]);
            const temps = forecastHours.map(h => h.temp_c);
            const pressures = forecastHours.map(h => h.pressure_mb);

            const canvas = document.getElementById('meteoChart');
            const ctx = canvas.getContext('2d');

            if (meteoChart) meteoChart.destroy();

            meteoChart = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: hours,
                    datasets: [
                        {
                            label: 'Temperatura (°C)',
                            data: temps,
                            borderColor: 'red',
                            yAxisID: 'y1',
                            tension: 0.2
                        },
                        {
                            label: 'QNH (hPa)',
                            data: pressures,
                            borderColor: 'blue',
                            yAxisID: 'y2',
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
                        y2: { type: 'linear', position: 'right', grid: { drawOnChartArea: false } }
                    }
                }
            });

            // Show canvas and date footer, hide error message
            canvas.style.display = 'block';
            meteoChartError.style.display = 'none';
            meteoChartDate.textContent = `Dati di riferimento: ${dateForTitle}`;
            meteoChartDate.style.display = 'block';

        } catch (err) {
            console.error('Errore caricamento meteo:', err);
            weatherInfoSpan.textContent = "Errore meteo";
            densityAltitudeSpan.textContent = "N/D";
            
            // Hide canvas and date footer, show error message
            const canvas = document.getElementById('meteoChart');
            canvas.style.display = 'none';
            meteoChartDate.style.display = 'none';
            meteoChartError.style.display = 'block';
            
            // Destroy existing chart if any
            if (meteoChart) {
                meteoChart.destroy();
                meteoChart = null;
            }
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

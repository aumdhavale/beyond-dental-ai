/* ═══════════════════════════════════════════════════════════
   BEYOND DENTAL HEALTH  —  Voice Call Engine  v3.0
   Natural · Human-like · Warm · Conversational
   ═══════════════════════════════════════════════════════════ */

'use strict';

/* ─────────────────────────────
   Live Clock
───────────────────────────── */
function updateClock() {
  const now = new Date();
  const t = document.getElementById('liveTime');
  const d = document.getElementById('liveDate');
  if (t) t.textContent = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  if (d) d.textContent = now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}
updateClock();
setInterval(updateClock, 1000);

/* ─────────────────────────────
   ❶  APPLICATION STATE
───────────────────────────── */
const state = {
  callActive: false,
  phase: 'idle',
  currentStep: 'start',
  bookingData: { patient_type: '', name: '', phone: '', email: '', date: '', time: '', reason: '' },
  currentPatient: null,   // populated for returning patients
  lastAppointment: null,
  appointments: [],
  queriesHandled: 0,
  silenceTimer: null,
  restartTimeout: null,
  keepAliveTimer: null,
  isSpeaking: false,
  isListening: false,
  ttsQueue: [],
  ttsPlaying: false,
};

const SILENCE_DEBOUNCE = 2200;
const SILENCE_PROMPT_MS = 13000;
const RESTART_DELAY_MS = 350;
const LISTEN_DELAY_MS = 600;
const SPEAK_DELAY_MS = 180;
const THINK_DELAY_MS = 280;

/* ─────────────────────────────
   PATIENT DATABASE  (localStorage)
   Simulates patients.json in the browser.
   Format: [{ id, name, phone, email }, ...]
───────────────────────────── */
const PatientDB = {
  KEY: 'bdh_patients',
  APPT_KEY: 'bdh_appointments',

  load() {
    try { return JSON.parse(localStorage.getItem(this.KEY)) || []; }
    catch (_) { return []; }
  },

  save(list) {
    try { localStorage.setItem(this.KEY, JSON.stringify(list)); } catch (_) { }
  },

  loadAppts() {
    try { return JSON.parse(localStorage.getItem(this.APPT_KEY)) || []; }
    catch (_) { return []; }
  },

  saveAppts(list) {
    try { localStorage.setItem(this.APPT_KEY, JSON.stringify(list)); } catch (_) { }
  },

  generateId() {
    const existing = new Set(this.load().map(p => p.id));
    let id;
    do {
      id = 'PAT' + String(1000 + Math.floor(Math.random() * 9000));
    } while (existing.has(id));
    return id;
  },

  findByIdOrPhone(query) {
    const q = query.replace(/[\s\-().+]/g, '').toUpperCase();
    return this.load().find(p =>
      p.id.toUpperCase() === q ||
      p.phone.replace(/[\s\-().+]/g, '') === q
    ) || null;
  },

  register(data) {
    const list = this.load();
    const patient = { id: this.generateId(), ...data };
    list.push(patient);
    this.save(list);
    return patient;
  },

  linkAppointment(apptData) {
    const list = this.loadAppts();
    list.push(apptData);
    this.saveAppts(list);
  },

  removeAppointmentById(patient_id) {
    let list = this.loadAppts();
    const initLen = list.length;
    list = list.filter(a => a.patient_id !== patient_id);
    this.saveAppts(list);
    return initLen > list.length;
  },

  updateAppointmentByPatient(patient, newDate, newTime) {
    let list = this.loadAppts();
    let updated = false;
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i].patient_id === patient.id || list[i].phone === patient.phone) {
        list[i].date = newDate;
        list[i].time = newTime;
        updated = true;
        break;
      }
    }
    this.saveAppts(list);
    return updated;
  }
};

// Pre-load any previously persisted appointments into state on page load
(function restoreSession() {
  const saved = PatientDB.loadAppts();
  if (saved.length) {
    state.appointments = saved;
    state.lastAppointment = saved[saved.length - 1];
  }
})();

/* ─────────────────────────────
   ❷  DOM REFS
───────────────────────────── */
const chatMessages = document.getElementById('chatMessages');
const userInputEl = document.getElementById('userInput');
const sendBtn = document.getElementById('sendBtn');
const micBtn = document.getElementById('micBtn');
const startCallBtn = document.getElementById('startCallBtn');
const endCallBtn = document.getElementById('endCallBtn');
const callOverlay = document.getElementById('callOverlay');
const callDuration = document.getElementById('callDuration');
const interimEl = document.getElementById('interimText');
const statusPill = document.getElementById('statusPill');
const apptListEl = document.getElementById('apptList');
const apptCountEl = document.getElementById('apptCount');
const cntBooked = document.getElementById('cntBooked');
const cntQueries = document.getElementById('cntQueries');
const statusBadge = document.getElementById('statusBadge');
const statusText = document.getElementById('statusText');
const modeVoiceBtn = document.getElementById('modeVoice');
const modeTextBtn = document.getElementById('modeText');

/* ─────────────────────────────
   ❸  PHRASE VARIATION BANK
   Pick a random item whenever you need a phrase
───────────────────────────── */
const phrases = {
  greeting: [
    "Thank you for calling Beyond Dental Health. This is your AI receptionist... how can I help you today?",
    "Hello, and welcome to Beyond Dental Health! I'm here to assist you. What can I do for you today?",
    "Good day! Thanks for reaching out to Beyond Dental Health. How may I help you?",
  ],
  askPatientKind: [
    "Hello! Thanks for calling Beyond Dental Health. Are you a new or an existing patient?",
    "Happy to help. Are you booking as a new patient, or have you visited us before?",
    "Got it. I can help you with that. Are you a new or a returning patient?",
  ],
  askLookup: [
    "Perfect! I'll just need your Patient ID or the phone number we have on file for you.",
    "Got it. Could you give me your Patient ID or phone number so I can find your record?",
    "That helps. May I have your Patient ID or the phone number on your account?",
  ],
  welcomeBack: [
    "Great to have you back, {name}! Let's get that scheduled for you.",
    "Welcome back, {name}! I've found your details. What date were you thinking for your appointment?",
    "Good to see you again, {name}! Since I already have your information, let's jump right into the scheduling.",
  ],
  askName: [
    "Got it, let's get you registered. May I have your full name, please?",
    "Perfect. Could you tell me your first and last name?",
    "Thanks for that. Let's get started! What is your full name?",
  ],
  askPhone: [
    "Thank you {name}. And what's a good phone number to reach you at?",
    "Got it! May I have your phone number, please?",
    "Perfect, and what's the best contact number for you?",
  ],
  askEmail: [
    "Got it. And what's your email address for the confirmation?",
    "That helps! May I have your email address, please?",
    "Thanks for that. And what email address should we send your appointment details to?",
  ],
  askDate: [
    "Perfect. What date would you like to come in?",
    "Got it. What day works best for you?",
    "Thanks for that. Which date should I look at for your visit?",
  ],
  askTime: [
    "And what time of day would you prefer?",
    "Thanks for that. Do you have a specific time in mind?",
    "Perfect. Any particular time that works for you on that day?",
  ],
  askReason: [
    "Last thing... what is the reason for your visit today? For example, is it for a cleaning, or perhaps a checkup?",
    "And finally... what will we be seeing you for? A cleaning, a consultation, or something else?",
    "Just to make sure we're prepared... what is the reason for your appointment?",
  ],
  confirming: [
    "Got it. Let me check that for you.",
    "One moment... checking our schedule.",
    "Let me see what I can find...",
  ],
  thankAck: [
    "Thanks for that. I've got it.",
    "Got it, thank you.",
    "Perfect, let me note that down.",
  ],
  notFoundId: [
    "Hmm, I couldn't find a record with those details. Let's go ahead and register you as a new patient then.",
    "I'm sorry, I couldn't find that in our system. Let's start a new registration for you.",
    "It seems I don't have that on file. No worries, let me get your information as a new patient.",
  ],
  notFoundAppt: [
    "I'm sorry, I couldn't find an appointment under your name. Would you like to schedule one?",
    "It seems I don't have a booking for you on file. Shall we make one now?",
    "I'm not seeing an active appointment. I can help you book one if you'd like?",
  ],
  done: [
    "Perfect! Your appointment is all set for {date} at {time}. We've sent a confirmation to {email}. We look forward to seeing you!",
    "All set! You're scheduled for {date} at {time}. You'll receive an email shortly at {email}. Have a wonderful day!",
    "Got it! I've booked your visit for {date} at {time}. A confirmation email is on its way to {email}. See you then!",
  ],
  emergency: [
    "I'm sorry to hear you're in pain... let me prioritize the earliest available slot for you. Let's get your details first.",
    "That sounds urgent... I'll make sure to find our quickest opening. Let's get you in our system first.",
    "We definitely want to get that seen to quickly. I'll search for the soonest possible time. May I have your details?",
  ],
  fallback: [
    "I'm your AI dental receptionist. I can help you book appointments, answer questions about our services, or help with emergencies. What can I do for you?",
    "I'm here to help with your dental needs... bookings, service info, or urgent care. How can I assist?",
  ],
  goodbye: [
    "Thank you for calling Beyond Dental Health. Have a great day.",
    "It was a pleasure assisting you. Thank you for calling Beyond Dental Health!",
    "Thanks for reaching out! Goodbye and have a lovely day.",
  ],
};

function pick(key, replacements = {}) {
  const arr = phrases[key];
  let s = arr[Math.floor(Math.random() * arr.length)];
  for (let [k, v] of Object.entries(replacements)) {
    s = s.replace(`{${k}}`, v);
  }
  return s;
}

/* ─────────────────────────────
   ❹  SPEECH ENGINE (TTS)
───────────────────────────── */
function getBestVoice() {
  const voices = window.speechSynthesis.getVoices();
  // Prefer high-quality neural/natural English voices
  return voices.find(v => (v.name.includes('Google') || v.name.includes('Natural')) && v.lang.startsWith('en'))
    || voices.find(v => v.lang.startsWith('en'))
    || voices[0];
}

function stopTTS() {
  window.speechSynthesis.cancel();
  state.isSpeaking = false;
  state.ttsPlaying = false;
  state.ttsQueue = [];
  updateVisualPhase('idle');
}

function agentReply(text, onEnd = null) {
  if (!text) return;

  // Lock the mic immediately upon processing to prevent auto-restarts
  shouldListen = false;
  state.isSpeaking = true;
  stopListening();

  showTypingIndicator();

  setTimeout(() => {
    removeTypingIndicator();
    appendMessage('agent', text);

    console.log("Speaking...");
    // Natural-format: break into chunks at pauses if long
    const chunks = text.split(/(?<=[.!?…])\s+/);

    updateVisualPhase('speaking');

    let current = 0;
    function speakNext() {
      if (current >= chunks.length) {
        state.isSpeaking = false;
        updateVisualPhase('idle');

        // Wait 800ms after speaking finishes before restarting mic
        setTimeout(() => {
          shouldListen = true;
          if (state.callActive && !state.isSpeaking) {
            startListening();
          }
          if (onEnd) onEnd();
        }, 800);
        return;
      }

      const utt = new SpeechSynthesisUtterance(chunks[current]);
      utt.voice = getBestVoice();
      utt.rate = 0.88 + (Math.random() * 0.05);  // slightly varied rate
      utt.pitch = 1.05 + (Math.random() * 0.1);   // warm tone
      utt.volume = 1.0;

      utt.onend = () => {
        current++;
        // Natural pause between chunks
        setTimeout(speakNext, 350);
      };

      utt.onerror = () => {
        state.isSpeaking = false;
        if (state.callActive) startListening();
      };

      window.speechSynthesis.speak(utt);
    }

    // Brief internal pause before starting TTS playback
    setTimeout(speakNext, 100);
  }, 800); // UI typing delay
}

/* ─────────────────────────────
   ❺  SPEECH RECOGNITION (STT)
───────────────────────────── */
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let recognitionRunning = false;
let shouldListen = true;
let pendingUtterance = '';

if (SpeechRecognition) {
  recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = 'en-US';

  recognition.onstart = () => {
    recognitionRunning = true;
    updateVisualPhase('listening');
  };

  recognition.onend = () => {
    console.log("Mic ended");
    recognitionRunning = false;
    state.isListening = false;
    
    if (shouldListen && state.callActive && !state.isSpeaking) {
      console.log("Restarting mic...");
      setTimeout(startListening, RESTART_DELAY_MS);
    } else {
      console.log("Mic intentionally stopped");
    }
  };

  recognition.onresult = (event) => {
    let interim = '';
    let finalReceived = false;
    for (let i = event.resultIndex; i < event.results.length; ++i) {
      if (event.results[i].isFinal) {
        pendingUtterance += event.results[i][0].transcript;
        finalReceived = true;
      } else {
        interim += event.results[i][0].transcript;
      }
    }

    if (interimEl) interimEl.textContent = interim;

    if (finalReceived) {
      // 1. IMMEDIATELY stop mic after user input is captured
      stopListening();
      if (pendingUtterance.trim()) {
        const text = pendingUtterance.trim();
        pendingUtterance = '';
        clearSilenceTimer();
        // 2. ALWAYS trigger agent response after input
        processUtterance(text);
      }
    } else if (interim || pendingUtterance) {
      // Reset silence timer whenever user speaks
      resetSilenceTimer();
      // If user starts speaking while agent is in a tiny gap, interrupt
      if (state.isSpeaking) stopTTS();
    }
  };
}

function startListening() {
  if (!shouldListen) return;
  if (state.isListening) return;

  if (recognition && !recognitionRunning && !state.isSpeaking && state.callActive) {
    try {
      console.log("Mic ON");
      console.log("Listening...");
      state.isListening = true;
      pendingUtterance = '';
      if (interimEl) interimEl.textContent = '';
      recognition.start();
    } catch (e) { }
  }
}

function stopListening() {
  shouldListen = false;
  
  if (recognition && recognitionRunning) {
    console.log("Mic OFF");
    recognition.stop();
    recognitionRunning = false;
    state.isListening = false;
  }
}

/* ─────────────────────────────
   ❻  CONVERSATION LOGIC
───────────────────────────── */
function showTypingIndicator() {
  if (!chatMessages) return;
  removeTypingIndicator(); // ensure no duplicates
  const ti = document.createElement('div');
  ti.className = 'msg agent typing-indicator-container';
  ti.innerHTML = `
    <div class="msg-avatar"><i class="fa-solid fa-robot"></i></div>
    <div style="display: flex; flex-direction: column;">
      <div class="msg-bubble typing-dots" style="padding: 10px 14px;">
        Agent is typing <span style="margin-left: 2px;"></span><span></span><span></span>
      </div>
    </div>
  `;
  chatMessages.appendChild(ti);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function removeTypingIndicator() {
  if (!chatMessages) return;
  const ti = chatMessages.querySelector('.typing-indicator-container');
  if (ti) ti.remove();
}

function appendMessage(role, text) {
  if (!chatMessages) return;
  removeTypingIndicator();

  const msg = document.createElement('div');
  msg.className = `msg ${role}`;
  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  // Use msg format to match style.css exactly for smooth animation and bubbles
  const avatarIcon = role === 'agent' ? '<i class="fa-solid fa-robot"></i>' : '<i class="fa-solid fa-user"></i>';
  msg.innerHTML = `
    <div class="msg-avatar">${avatarIcon}</div>
    <div style="display: flex; flex-direction: column; align-items: ${role === 'user' ? 'flex-end' : 'flex-start'};">
      <div class="msg-bubble">${escapeHtml(text)}</div>
      <div class="msg-time">${time}</div>
    </div>
  `;

  chatMessages.appendChild(msg);
  // Smooth scroll
  chatMessages.scrollTo({ top: chatMessages.scrollHeight, behavior: 'smooth' });
  if (role === 'agent') state.queriesHandled++;
  updateStats();
}

function escapeHtml(unsafe) {
  return unsafe.replace(/[&<"']/g, m => ({ '&': '&amp;', '<': '&lt;', '"': '&quot;', "'": "&#039;" }[m]));
}

/* ─────────────────────────────
   ❼  SILENCE / TURN HANDLING
───────────────────────────── */
function resetSilenceTimer() {
  clearSilenceTimer();
  // If user stops speaking for SILENCE_DEBOUNCE, process it
  state.silenceTimer = setTimeout(() => {
    if (pendingUtterance.trim()) {
      const text = pendingUtterance.trim();
      pendingUtterance = '';
      processUtterance(text);
    }
  }, SILENCE_DEBOUNCE);
}

function clearSilenceTimer() {
  if (state.silenceTimer) clearTimeout(state.silenceTimer);
}

/* ─────────────────────────────
   ❽  UI UPDATES
───────────────────────────── */
function updateVisualPhase(p) {
  state.phase = p;
  const lp = document.getElementById('listeningWave');
  const sp = document.getElementById('speakingWave');
  const pill = document.getElementById('statusPill');
  const pText = document.getElementById('statusPillText');

  if (lp) lp.classList.toggle('active', p === 'listening');
  if (sp) sp.classList.toggle('active', p === 'speaking');

  if (pill) {
    pill.className = `status-pill pill-${p}`;
    if (pText) {
      pText.textContent = p.charAt(0).toUpperCase() + p.slice(1) + '…';
    }
  }
}

function setPhase(p) {
  updateVisualPhase(p);
  const ind = document.getElementById('speakingIndicator');
  if (ind) ind.style.display = (p === 'speaking') ? 'flex' : 'none';
}

function updateProgress(step) {
  document.querySelectorAll('.step').forEach(el => {
    const s = el.dataset.step;
    el.classList.remove('active', 'done');
    if (s === step) el.classList.add('active');
    // Simplified: mark all previous steps as done (for linear flow)
    // Actually, in our FSM, we'll mark them manually as we go
  });

  const currentEl = document.querySelector(`.step[data-step="${step}"]`);
  if (currentEl) currentEl.classList.add('active');

  // Mark previous steps based on defined order
  const order = ['ask_patient_kind', 'ask_lookup', 'name', 'phone', 'email', 'date', 'time', 'reason'];
  const idx = order.indexOf(step);
  if (idx > 0) {
    for (let i = 0; i < idx; i++) {
      const prev = document.querySelector(`.step[data-step="${order[i]}"]`);
      if (prev) prev.classList.add('done');
    }
  }
}

function clearProgress() {
  document.querySelectorAll('.step').forEach(el => el.classList.remove('active', 'done'));
}

/* ─────────────────────────────
   ❾  BOOKING FSM (Finite State Machine)
───────────────────────────── */
function extractIdOrPhone(input) {
  const normalized = input.toLowerCase().replace(/[\s.-]+/g, '');

  // Try ID match (e.g., pat9958)
  const idMatch = normalized.match(/pat(\d{3,6})/);
  if (idMatch) {
    return 'PAT' + idMatch[1];
  }

  // Try phone (8-12 digits)
  const digitMatch = normalized.match(/\d{8,12}/);
  if (digitMatch) {
    return digitMatch[0];
  }

  return input.trim();
}

function isYes(input) {
    return /^(yes|yeah|yep|correct|right|yes yes|yup)$/i.test(input.trim());
}

function isNo(input) {
    return /^(no|nope|wrong|incorrect)$/i.test(input.trim());
}

function handleBookingStep(input) {
  const lower = input.toLowerCase();
  const bd = state.bookingData;

  function invalidInput(msg) {
    state.failedAttempts = (state.failedAttempts || 0) + 1;
    if (state.failedAttempts >= 2) {
      agentReply("Let me help you with that... " + msg);
      state.failedAttempts = 0;
    } else {
      agentReply(msg);
    }
  }

  if (/(fuck|shit|bitch|asshole|shut up|idiot|stupid)/i.test(lower)) {
    agentReply("I'm here to help. Let's continue with your booking.");
    return true;
  }

  switch (state.currentStep) {
    case 'start':
      // Trigger booking if intent detected
      if (/\b(book|appointment|appointments|schedule|scheduling|visit)\b/i.test(lower)) {
        state.currentStep = 'ask_patient_kind';
        updateProgress('ask_patient_kind');
        agentReply(pick('askPatientKind'));
        return true;
      }
      return false;

    case 'lookup_for_recall':
      const extRecall = extractIdOrPhone(input);
      const patRecall = PatientDB.findByIdOrPhone(extRecall);
      if (patRecall) {
        state.currentPatient = patRecall;
        const appts = state.appointments.filter(a => a.patient_id === patRecall.id || a.phone === patRecall.phone);
        if (appts.length > 0) {
          const a = appts[appts.length - 1]; // get latest
          agentReply(`Got it, I found your record. Your appointment is on ${a.date} at ${a.time} for ${a.reason}.`);
        } else {
          agentReply(`Got it, I found your record, ${patRecall.name.split(' ')[0]}, but you don't have any upcoming appointments.`);
        }
        state.currentStep = 'start';
      } else {
        invalidInput("I couldn't find a record with that. Could you please provide your patient ID or phone number again?");
      }
      break;

    case 'lookup_for_cancel':
      const extCancel = extractIdOrPhone(input);
      const patCancel = PatientDB.findByIdOrPhone(extCancel);
      if (patCancel) {
        const removed = PatientDB.removeAppointmentById(patCancel.id);
        if (removed) {
          state.appointments = PatientDB.loadAppts();
          if (state.lastAppointment && state.lastAppointment.patient_id === patCancel.id) {
            state.lastAppointment = state.appointments.length ? state.appointments[state.appointments.length - 1] : null;
          }
          agentReply(`Got it, I found your record. Your appointment has been successfully cancelled, ${patCancel.name.split(' ')[0]}. Is there anything else I can assist with?`);
        } else {
          agentReply(`Got it, I found your record, ${patCancel.name.split(' ')[0]}, but you don't have any upcoming appointments to cancel.`);
        }
        state.currentStep = 'start';
      } else {
        invalidInput("I couldn't find a record with that. Could you please provide your patient ID or phone number again?");
      }
      break;

    case 'lookup_for_reschedule':
      const extResched = extractIdOrPhone(input);
      const patResched = PatientDB.findByIdOrPhone(extResched);
      if (patResched) {
        state.currentPatient = patResched;
        const appts = state.appointments.filter(a => a.patient_id === patResched.id || a.phone === patResched.phone);
        if (appts.length > 0) {
          const a = appts[appts.length - 1];
          agentReply(`Got it, I found your record. I see your appointment on ${a.date} at ${a.time}. What new date would work better for you?`);
          state.isRescheduling = true;
          state.currentStep = 'date';
        } else {
          agentReply(`Got it, I found your record, ${patResched.name.split(' ')[0]}, but you don't have any appointments to reschedule. We can make a new one!`);
          state.currentStep = 'start';
        }
      } else {
        invalidInput("I couldn't find a record with that. Could you please provide your patient ID or phone number again?");
      }
      break;

    case 'ask_patient_kind':
      if (/\breturning\b|\bold\b|\bexisting\b/i.test(lower)) {
        state.currentStep = 'ask_lookup';
        updateProgress('ask_lookup');
        agentReply(pick('askLookup'));
      } else {
        // Assume new if not clearly returning
        state.currentStep = 'name';
        updateProgress('name');
        agentReply(pick('askName'));
      }
      break;

    case 'ask_lookup':
      const extLookup = extractIdOrPhone(input);
      const patient = PatientDB.findByIdOrPhone(extLookup);
      if (patient) {
        state.currentPatient = patient;
        bd.name = patient.name;
        bd.phone = patient.phone;
        bd.email = patient.email;
        // Skip registration, go to scheduling
        state.currentStep = 'date';
        updateProgress('date');
        agentReply(`Got it, I found your record. ` + pick('welcomeBack', { name: patient.name.split(' ')[0] }) + ' ' + pick('askDate'));
      } else {
        invalidInput(pick('notFoundId') + " Could you please provide your patient ID or phone number again?");
      }
      break;

    case 'name':
      if (input.trim().split(/\s+/).length < 2) {
        invalidInput("I didn't quite catch your full name. Could you please provide your first and last name?");
        return true;
      }
      state.failedAttempts = 0;
      bd.name = input;
      const spokenName = input.split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
      state.currentStep = 'name_confirm';
      agentReply(`Did I get your name right as ${spokenName}?`);
      break;

    case 'name_confirm':
      if (/^(yes|yeah|yep|correct|that's right|sure|it is|right)$/i.test(lower)) {
        state.currentStep = 'phone';
        updateProgress('phone');
        agentReply(pick('askPhone', { name: bd.name.split(' ')[0].charAt(0).toUpperCase() + bd.name.split(' ')[0].slice(1) }));
      } else {
        state.currentStep = 'name_spell';
        agentReply("Could you please spell your name?");
      }
      break;

    case 'name_spell':
      let spelledName = input.replace(/\s/g, '');
      spelledName = spelledName.charAt(0).toUpperCase() + spelledName.slice(1).toLowerCase();
      bd.name = spelledName;
      state.currentStep = 'phone';
      updateProgress('phone');
      agentReply(pick('askPhone', { name: spelledName }));
      break;

    case 'phone':
      const digitCount = (input.match(/\d/g) || []).length;
      if (digitCount < 8 || digitCount > 15) {
        invalidInput("I didn't quite get that. Could you please share your phone number?");
        return true;
      }
      state.failedAttempts = 0;
      bd.phone = input;
      state.currentStep = 'email';
      updateProgress('email');
      agentReply(pick('askEmail'));
      break;

    case 'email':
      const cleanedEmail = input.replace(/\s+at\s+/gi, '@').replace(/\s*dot\s*/gi, '.').replace(/\s+/g, '').toLowerCase();
      if (!cleanedEmail.includes('@') || !cleanedEmail.includes('.')) {
        invalidInput("That doesn't seem like a valid email. Could you please share it again?");
        return true;
      }
      state.failedAttempts = 0;
      bd.email = cleanedEmail;
      state.currentStep = 'date';
      updateProgress('date');
      agentReply(pick('askDate'));
      break;

    case 'date':
      if (!/\d/.test(lower) && !/(monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|tomorrow|next)/i.test(lower)) {
        invalidInput("I'm sorry, I didn't catch the date. Could you please provide a specific date, like 12th March?");
        return true;
      }
      if (/^(monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/i.test(lower.trim())) {
        const dayName = input.trim();
        invalidInput(`Just to confirm, do you mean this coming ${dayName.charAt(0).toUpperCase() + dayName.slice(1)} or a specific date?`);
        return true;
      }
      state.failedAttempts = 0;

      let parsedDate = input;
      const tLower = lower.trim();
      if (/(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)/.test(tLower)) {
        let today = new Date();
        if (tLower.includes('tomorrow')) {
          today.setDate(today.getDate() + 1);
        } else if (!tLower.includes('today')) {
          const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
          const targetDay = days.findIndex(d => tLower.includes(d));
          if (targetDay !== -1) {
            let diff = targetDay - today.getDay();
            if (diff <= 0) diff += 7;
            if (tLower.includes('next')) diff += 7;
            today.setDate(today.getDate() + diff);
          }
        }
        parsedDate = today.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
      }
      bd.date = parsedDate;
      state.currentStep = 'time';
      updateProgress('time');
      agentReply(pick('askTime'));
      break;

    case 'time':
      let parsedLower = lower;
      let parsedInput = input;
      if (/(morning|afternoon|evening|night)/.test(lower)) {
        if (lower.includes('morning')) { parsedLower = '9 am'; parsedInput = '9 AM'; }
        else if (lower.includes('afternoon')) { parsedLower = '2 pm'; parsedInput = '2 PM'; }
        else if (lower.includes('evening')) { parsedLower = '6 pm'; parsedInput = '6 PM'; }
        else if (lower.includes('night')) { parsedLower = '8 pm'; parsedInput = '8 PM'; }
      }
      let normalizedTime = parsedLower.replace(/[.\s]/g, '');

      // Handle follow-up AM/PM response
      if (/^(am|pm)$/.test(normalizedTime) && state.pendingTimeHour) {
        bd.time = `${state.pendingTimeHour} ${normalizedTime.toUpperCase()}`;
        state.pendingTimeHour = null;
        state.currentStep = 'date_time_confirm';
        state.awaitingConfirmation = true;
        agentReply(`You're looking for ${bd.date} at ${bd.time}, right?`);
        break;
      }

      if (!/\d/.test(normalizedTime)) {
        invalidInput("That doesn't seem like a valid time. Could you try again?");
        return true;
      }

      if (!/(am|pm)/.test(normalizedTime)) {
        const numMatch = normalizedTime.match(/\d{1,2}(:\d{2})?/);
        if (numMatch) {
          const num = numMatch[0];
          state.pendingTimeHour = num;
          invalidInput(`Would that be ${num} AM or ${num} PM?`);
          return true;
        }
      }
      state.failedAttempts = 0;

      // Store final time cleanly
      const tNum = normalizedTime.match(/\d{1,2}(:\d{2})?/);
      const tSuffix = normalizedTime.match(/am|pm/);
      if (tNum && tSuffix) {
        bd.time = `${tNum[0]} ${tSuffix[0].toUpperCase()}`;
      } else {
        bd.time = parsedInput; // fallback
      }

      state.pendingTimeHour = null; // clear it just in case
      state.currentStep = 'date_time_confirm';
      state.awaitingConfirmation = true;
      agentReply(`You're looking for ${bd.date} at ${bd.time}, right?`);
      break;

    case 'date_time_confirm':
      if (isYes(lower)) {
        state.awaitingConfirmation = false;
        if (state.isRescheduling) {
          PatientDB.updateAppointmentByPatient(state.currentPatient, bd.date, bd.time);
          state.appointments = PatientDB.loadAppts();
          agentReply(`All set! I've rescheduled your appointment for ${bd.date} at ${bd.time}. We'll send an updated confirmation.`);
          state.isRescheduling = false;
          state.currentStep = 'start';
          clearProgress();
        } else {
          state.currentStep = 'reason';
          updateProgress('reason');
          agentReply("Perfect, I've got that confirmed. " + pick('askReason'));
        }
      } else if (isNo(lower)) {
        state.awaitingConfirmation = false;
        state.currentStep = 'date';
        updateProgress('date');
        agentReply("Let's try that again. What date would you like to come in?");
      } else {
        invalidInput("I didn't quite catch that. Please confirm with yes or no.");
      }
      break;

    case 'reason':
      if (lower.trim().length < 4 || /^(ok|okay|yes|no|friday|saturday|sunday|monday|tuesday|wednesday|thursday)$/i.test(lower.trim())) {
        invalidInput("Could you please provide a proper reason for your visit?");
        return true;
      }
      state.failedAttempts = 0;
      bd.reason = input;
      saveAppointment();
      let patMsg = "";
      if (state.currentPatient && state.currentPatient.id) {
        patMsg = ` Your patient ID is ${state.currentPatient.id}. You can use this next time for faster booking.`;
      }
      agentReply(pick('done', { date: bd.date, time: bd.time, email: bd.email }) + patMsg);
      state.currentStep = 'start';
      clearProgress();
      break;
  }
  return true;
}

/* ─────────────────────────────
   ⓯  APPOINTMENTS
───────────────────────────── */
function saveAppointment() {
  const bd = state.bookingData;
  let patient_id = state.currentPatient ? state.currentPatient.id : null;

  // Register as new patient on first booking
  if (!patient_id && bd.name && bd.phone) {
    const newPat = PatientDB.register({ name: bd.name, phone: bd.phone, email: bd.email || '' });
    patient_id = newPat.id;
    state.currentPatient = newPat;
  }

  const data = {
    patient_id,
    name: bd.name,
    phone: bd.phone,
    email: bd.email,
    date: bd.date,
    time: bd.time,
    reason: bd.reason,
  };

  state.appointments.push(data);
  state.lastAppointment = data;
  PatientDB.linkAppointment(data);  // persist to localStorage
  renderAppointments();
  updateStats();
}

function renderAppointments() {
  if (!apptListEl) return;
  if (!state.appointments.length) {
    apptListEl.innerHTML = `<div class="empty-state"><i class="fa-regular fa-calendar-xmark"></i><p>No appointments yet</p></div>`;
    return;
  }
  apptListEl.innerHTML = state.appointments.map(a => `
    <div class="appt-item">
      <div class="appt-name">
        <i class="fa-solid fa-user-circle" style="color:var(--teal);margin-right:6px"></i>
        ${escapeHtml(a.name || 'Patient')}
        ${a.patient_id ? `<span style="background:rgba(0,217,192,.15);color:var(--teal);
          border-radius:6px;padding:1px 7px;font-size:.68rem;font-weight:700;
          margin-left:6px;letter-spacing:.05em">${escapeHtml(a.patient_id)}</span>` : ''}
      </div>
      <div class="appt-detail"><i class="fa-solid fa-calendar"></i>${escapeHtml(a.date)} at ${escapeHtml(a.time)}</div>
      <div class="appt-detail"><i class="fa-solid fa-notes-medical"></i>${escapeHtml(a.reason)}</div>
    </div>`).join('');
}


function updateStats() {
  if (cntQueries) cntQueries.textContent = state.queriesHandled;
  if (cntBooked) cntBooked.textContent = state.appointments.length;
  if (apptCountEl) apptCountEl.textContent = state.appointments.length;
}

/* ─────────────────────────────
   ⓰  EMERGENCY BANNER
───────────────────────────── */
function showEmergency() {
  let b = document.getElementById('emergencyBanner');
  if (!b) {
    b = document.createElement('div');
    b.id = 'emergencyBanner';
    b.className = 'emergency-banner';
    b.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> Emergency detected — prioritising earliest slot!`;
    document.body.appendChild(b);
  }
  b.classList.add('show');
  setTimeout(() => b.classList.remove('show'), 5000);
}

/* ─────────────────────────────
   INTENT ROUTER
   Priority: Exit → Appt Recall → Emergency → General → Booking → Fallback
───────────────────────────── */
function generalHandler(input) {
  const lower = input.toLowerCase();

  /* 1️⃣  EXIT INTENT — always wins */
  if (/\b(bye|bye bye|goodbye|good bye|exit|stop|hang up|end call|that'?s all|no thanks|nothing else|take care|see you)\b/i.test(lower)) {
    agentReply(pick('goodbye'), () => endCall());
    return;
  }

  /* 2️⃣  APPOINTMENT RECALL */
  if (/my appointment|my booking|appointment detail|what did i book|when is my|when am i|did i book/i.test(lower)) {
    if (state.lastAppointment) {
      const a = state.lastAppointment;
      agentReply(
        `Your appointment is scheduled on ${a.date} at ${a.time}` +
        (a.name ? ` for ${a.name}` : '') +
        (a.reason ? `, regarding ${a.reason}` : '') +
        '. Is there anything else I can help with?'
      );
    } else {
      agentReply(pick('notFoundAppt'));
    }
    return;
  }

  /* 2.5️⃣ ID SEARCH / MY ID IS */
  const idMatch = lower.match(/\b(pat\d{4})\b/i);
  if (idMatch || /\b(what is my id|my id)\b/i.test(lower)) {
    if (idMatch) {
      const patient = PatientDB.findByIdOrPhone(idMatch[1]);
      if (patient) {
        const appts = state.appointments.filter(a => a.patient_id === patient.id);
        if (appts.length > 0) {
          const a = appts[appts.length - 1]; // get latest
          agentReply(`I found your record, ${patient.name.split(' ')[0]}. Your next appointment is on ${a.date} at ${a.time} for ${a.reason}.`);
          state.lastAppointment = a;
        } else {
          agentReply(`I found your profile, ${patient.name.split(' ')[0]}, but you don't have any upcoming appointments.`);
        }
        state.currentPatient = patient;
      } else {
        agentReply("I couldn't find your record. Could you please confirm your phone number?");
      }
    } else if (state.currentPatient && state.currentPatient.id) {
      agentReply(`Your patient ID is ${state.currentPatient.id}.`);
    } else {
      agentReply("I couldn't find your record. Could you please confirm your phone number?");
    }
    return;
  }

  /* 3️⃣  EMERGENCY */
  if (/pain|bleeding|broken|swelling|emergency|urgent|cracked|knocked out/i.test(lower)) {
    showEmergency();
    agentReply(pick('emergency'), () => {
      if (state.currentStep === 'start') {
        state.currentStep = 'ask_patient_kind';
        updateProgress('ask_patient_kind');
      }
    });
    return;
  }

  /* 4️⃣  DATE */
  if (/\b(date|today|what day is it)\b/i.test(lower) && !/appointment/i.test(lower)) {
    const d = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    agentReply(`Today is ${d}.`);
    return;
  }

  /* 5️⃣  TIME */
  if (/\b(time|current time)\b/i.test(lower) && !/appointment/i.test(lower)) {
    const t = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    agentReply(`The current time is ${t}.`);
    return;
  }

  /* 9️⃣  EXPLICIT BOOKING REQUEST */
  if (/\b(book|appointment|appointments|schedule|scheduling|visit)\b/i.test(lower)) {
    if (state.currentStep === 'start') {
      state.currentStep = 'ask_patient_kind';
      updateProgress('ask_patient_kind');
      agentReply(pick('askPatientKind'));
    }
    return;
  }

  /* 🔟  FALLBACK */
  agentReply(pick('thankAck') + ' ' + pick('fallback'));
}

/* ─────────────────────────────
   MAIN INPUT PROCESSOR
───────────────────────────── */
function processUtterance(text) {
  text = text.trim();
  if (!text || text.length < 2) return;

  // Hard gates
  if (!state.callActive) return;
  if (state.isSpeaking) return;

  stopListening();
  setPhase('thinking');
  appendMessage('user', text);
  if (userInputEl) userInputEl.value = '';

  const lower = text.toLowerCase();

  // Exit intent always wins regardless of booking step
  if (/\b(bye|bye bye|goodbye|good bye|exit|stop|hang up|end call|that'?s all)\b/i.test(lower)) {
    generalHandler(text);
    return;
  }

  // Mid-booking: check for side-questions first, otherwise continue collecting data
  if (state.currentStep !== 'start') {
    const isSideQuestion = /my appointment|my booking|what time|what date|service|hour|open|close|emergency|pain|bleed/i.test(lower);
    if (isSideQuestion) {
      generalHandler(text);   // answer it, stay on same booking step
      return;
    }
    handleBookingStep(text);  // continue booking flow
    return;
  }

  // At 'start': try recall intent first
  if (state.currentStep === 'start') {
    if (/cancel.*appointment|cancel.*booking|delete.*appointment|remove.*booking|cancel/i.test(lower)) {
      state.currentStep = 'lookup_for_cancel';
      agentReply("I can help you cancel that. Could you please provide your patient ID or phone number?");
      return;
    }
    if (/reschedule|change.*appointment|change.*time|change.*date|change.*booking/i.test(lower)) {
      state.currentStep = 'lookup_for_reschedule';
      agentReply("I can help you reschedule. Could you please provide your patient ID or phone number?");
      return;
    }
    if (/when is my|my appointment|my booking|what did i book|when am i|did i book|my time/i.test(lower)) {
      state.currentStep = 'lookup_for_recall';
      agentReply("Sure, I can check that for you. Could you please provide your patient ID or phone number?");
      return;
    }
  }

  // Then try booking intent, then general handler
  const handled = handleBookingStep(text);
  if (!handled) generalHandler(text);
}


/* ─────────────────────────────
   ⓳  CALL START / END
───────────────────────────── */
function startCall() {
  if (state.callActive) return;
  state.callActive = true;

  if (callOverlay) callOverlay.classList.add('active');
  if (startCallBtn) startCallBtn.style.display = 'none';
  if (endCallBtn) endCallBtn.style.display = 'flex';
  if (statusBadge) statusBadge.className = 'status-badge online';
  if (statusText) statusText.textContent = 'Call Active';

  startCallTimer();
  agentReply(pick('greeting'));
}

function endCall() {
  if (!state.callActive && !state.isSpeaking) return; // already ended

  // 1. Stop all speech and listening IMMEDIATELY
  try { window.speechSynthesis.cancel(); } catch (_) { }
  stopListening();
  stopTTS();
  stopCallTimer();
  clearSilenceTimer();
  clearTimeout(state.restartTimeout);
  clearInterval(state.keepAliveTimer);

  // 2. Flip flags
  state.callActive = false;
  state.isSpeaking = false;
  recognitionRunning = false;
  pendingUtterance = '';

  // 3. Reset booking state but KEEP lastAppointment (user may ask about it)
  state.currentStep = 'start';
  state.bookingData = { patient_type: '', name: '', phone: '', email: '', date: '', time: '', reason: '' };
  clearProgress();
  setPhase('idle');

  // 4. Update UI
  if (callOverlay) callOverlay.classList.remove('active');
  if (startCallBtn) startCallBtn.style.display = 'flex';
  if (endCallBtn) endCallBtn.style.display = 'none';
  if (statusBadge) statusBadge.className = 'status-badge offline';
  if (statusText) statusText.textContent = 'Call Ended';

  // Disable input until next call starts
  if (userInputEl) { userInputEl.disabled = true; userInputEl.placeholder = 'Call ended — click Start Call to begin'; }
  if (micBtn) micBtn.disabled = true;

  // 5. Restore UI after 3 seconds
  setTimeout(() => {
    if (statusText) statusText.textContent = 'Agent Online';
    if (statusBadge) statusBadge.className = 'status-badge online';
    if (userInputEl) { userInputEl.disabled = false; userInputEl.placeholder = 'Start a call or type your message…'; }
    if (micBtn) micBtn.disabled = false;
  }, 3000);
}

/* ─────────────────────────────
   ⓴  TEXT INPUT (manual fallback)
───────────────────────────── */
if (sendBtn) {
  sendBtn.addEventListener('click', () => {
    const v = userInputEl ? userInputEl.value.trim() : '';
    if (!v) return;
    if (!state.callActive) {
      startCall();
      setTimeout(() => processUtterance(v), 2200);
    } else {
      stopListening();
      processUtterance(v);
    }
  });
}
if (userInputEl) {
  userInputEl.addEventListener('keydown', e => {
    if (e.key === 'Enter') sendBtn && sendBtn.click();
  });
}

/* ─────────────────────────────
   ㉑  MIC BUTTON (interrupt / start)
───────────────────────────── */
if (micBtn) {
  micBtn.addEventListener('click', () => {
    if (!state.callActive) {
      startCall();
    } else if (state.isSpeaking) {
      // Interrupt agent
      stopTTS();
      setTimeout(startListening, 200);
    } else if (recognitionRunning) {
      const p = pendingUtterance.trim();
      if (p) { pendingUtterance = ''; stopListening(); processUtterance(p); }
    }
  });
}

/* ─────────────────────────────
   ㉒  CALL BUTTONS
───────────────────────────── */
if (startCallBtn) startCallBtn.addEventListener('click', startCall);
if (endCallBtn) endCallBtn.addEventListener('click', () => {
  agentReply(pick('goodbye'));
});

/* ─────────────────────────────
   ㉓  MODE TOGGLE
───────────────────────────── */
if (modeVoiceBtn) {
  modeVoiceBtn.addEventListener('click', () => {
    modeVoiceBtn.classList.add('chip-active');
    modeTextBtn && modeTextBtn.classList.remove('chip-active');
    if (userInputEl) userInputEl.placeholder = 'Start a call or use the mic…';
  });
}
if (modeTextBtn) {
  modeTextBtn.addEventListener('click', () => {
    modeTextBtn.classList.add('chip-active');
    modeVoiceBtn && modeVoiceBtn.classList.remove('chip-active');
    if (userInputEl) { userInputEl.placeholder = 'Type your message…'; userInputEl.focus(); }
  });
}

/* ─────────────────────────────
   ㉔  FAQ CHIPS
───────────────────────────── */
document.querySelectorAll('.faq-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    const q = chip.dataset.q;
    if (!state.callActive) {
      startCall();
      setTimeout(() => processUtterance(q), 2200);
    } else {
      stopListening();
      processUtterance(q);
    }
  });
});

/* ─────────────────────────────
   ㉕  INFO / CALL TIMER
───────────────────────────── */
let callStartTime = 0;
let callInterval = null;

function startCallTimer() {
  callStartTime = Date.now();
  callInterval = setInterval(() => {
    const s = Math.floor((Date.now() - callStartTime) / 1000);
    const m = Math.floor(s / 60);
    const ss = s % 60;
    if (callDuration) callDuration.textContent = `${m.toString().padStart(2, '0')}:${ss.toString().padStart(2, '0')}`;
  }, 1000);
}

function stopCallTimer() {
  if (callInterval) clearInterval(callInterval);
  if (callDuration) callDuration.textContent = '00:00';
}

/* ─────────────────────────────
   ㉖  INIT
───────────────────────────── */
window.addEventListener('DOMContentLoaded', () => {
  renderAppointments();
  updateStats();
  setPhase('idle');

  if (!SpeechRecognition) {
    const w = document.createElement('div');
    w.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#ef4444;color:#fff;padding:10px 20px;border-radius:10px;font-size:.8rem;z-index:999;display:flex;gap:8px;align-items:center;';
    w.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> Voice input requires Google Chrome. Text input still works.';
    document.body.appendChild(w);
    setTimeout(() => w.remove(), 7000);
  }
});

/* ─────────────────────────────
   TAB CONTROLLER  (appended — do not modify above)
───────────────────────────── */
(function initTabs() {
  const tabs = [
    { tab: 'tabDashboard', view: 'viewDashboard' },
    { tab: 'tabAppointments', view: 'viewAppointments' },
    { tab: 'tabAnalytics', view: 'viewAnalytics' },
  ];

  function switchTab(activeView) {
    tabs.forEach(({ tab, view }) => {
      const tabEl = document.getElementById(tab);
      const viewEl = document.getElementById(view);
      const isActive = view === activeView;
      if (tabEl) tabEl.classList.toggle('active', isActive);
      if (viewEl) viewEl.style.display = isActive ? '' : 'none';
    });
    // Re-render appointments list whenever that tab becomes visible
    if (activeView === 'viewAppointments') renderAppointments();
  }

  tabs.forEach(({ tab, view }) => {
    const tabEl = document.getElementById(tab);
    if (tabEl) {
      tabEl.addEventListener('click', e => {
        e.preventDefault();
        switchTab(view);
      });
    }
  });

  // Set initial state: Dashboard visible, others hidden
  switchTab('viewDashboard');
})();

/**
 * VocalDesk – SPA App Logic
 * Screen routing · MediaRecorder · API client · Admin auth · Dashboard
 */

'use strict';

let audioContext = null;
let analyser     = null;
let dataArray    = null;
let visFrame     = null;

// ════════════════════════════════════════════════════════════════
// PARTICLE BACKGROUND GENERATOR
// ════════════════════════════════════════════════════════════════

function initParticles() {
  const bg = document.getElementById('particle-bg');
  if (!bg) return;
  const count = 28;
  for (let i = 0; i < count; i++) {
    const p = document.createElement('div');
    p.className = 'particle';
    p.style.left = Math.random() * 100 + '%';
    p.style.top  = Math.random() * 100 + '%';
    p.style.setProperty('--dur',   (3.5 + Math.random() * 4) + 's');
    p.style.setProperty('--delay', (Math.random() * 4) + 's');
    p.style.width = p.style.height = (4 + Math.random() * 5) + 'px';
    bg.appendChild(p);
  }
}

// ════════════════════════════════════════════════════════════════
// API CLIENT
// ════════════════════════════════════════════════════════════════

const API_BASE = (window.location.origin.includes('localhost') || window.location.protocol === 'file:')
  ? 'http://localhost:8001'
  : 'https://vocaldesk-backend-7pxz.onrender.com';

const api = {
  token: sessionStorage.getItem('vocaldesk_token') || null,

  headers(json = true) {
    const h = {};
    if (json) h['Content-Type'] = 'application/json';
    if (this.token) h['Authorization'] = `Bearer ${this.token}`;
    return h;
  },

  async post(path, body, isForm = false) {
    const opts = {
      method: 'POST',
      headers: this.headers(!isForm),
      body: isForm ? body : JSON.stringify(body),
    };
    const res = await fetch(`${API_BASE}${path}`, opts);
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || `HTTP ${res.status}`);
    }
    return res.json();
  },

  async get(path) {
    const res = await fetch(`${API_BASE}${path}`, { headers: this.headers() });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || `HTTP ${res.status}`);
    }
    return res.json();
  },
};

// ════════════════════════════════════════════════════════════════
// SCREEN ROUTER
// ════════════════════════════════════════════════════════════════

let _prevScreen = 'marketing';
let currentScreen = 'marketing';

function showScreen(name) {
  const cur = document.querySelector('.screen.active');
  if (cur) {
    _prevScreen = cur.id.replace('screen-', '');
    cur.classList.remove('active');
  }
  currentScreen = name;
  const next = document.getElementById(`screen-${name}`);
  if (next) {
    next.classList.add('active');
    next.scrollTop = 0;
    _onScreenEnter(name);
  }
  
  // Update global controls visibility
  const globalControls = document.querySelector('.global-controls');
  if (globalControls) {
    if (name === 'admin-dashboard') {
      globalControls.style.display = 'none';
    } else {
      globalControls.style.display = 'flex';
    }
  }

  // Update back button visibility specifically
  const btnBack = document.getElementById('btn-back');
  if (btnBack) {
    if (name === 'marketing' || name === 'landing' || name === 'admin-login') {
      btnBack.style.display = 'none';
    } else {
      btnBack.style.display = 'flex';
    }
  }
}

function goBack() {
  if (currentScreen === 'admin-dashboard') showScreen('admin-login');
  else if (currentScreen === 'voice-input') showScreen('landing');
  else if (currentScreen === 'summary') showScreen('landing');
  else if (currentScreen === 'signup' || currentScreen === 'admin-login' || currentScreen === 'user-login') showScreen('marketing');
  else showScreen('marketing');
}

function toggleTheme() {
  const isDark = document.body.getAttribute('data-theme') === 'dark';
  if (isDark) {
    document.body.removeAttribute('data-theme');
    localStorage.setItem('vocaldesk_theme', 'light');
  } else {
    document.body.setAttribute('data-theme', 'dark');
    localStorage.setItem('vocaldesk_theme', 'dark');
  }
}

// Restore theme
if (localStorage.getItem('vocaldesk_theme') === 'dark') {
  document.body.setAttribute('data-theme', 'dark');
}

// ════════════════════════════════════════════════════════════════
// CALL MODE LOGIC
// ════════════════════════════════════════════════════════════════

let callTimerInterval = null;
let callStartTime = null;
let isCallMode = false;

async function startCallMode() {
  isCallMode = true;
  showScreen('call-mode');
  
  callStartTime = Date.now();
  updateCallTimer();
  callTimerInterval = setInterval(updateCallTimer, 1000);
  
  document.getElementById('call-ai-status').textContent = 'Connecting...';
  
  // Trigger initial AI greeting instead of immediately recording
  try {
    const data = await api.post('/api/text-input', {
      message: "Hello",
      conversation_history: conversationHistory,
    });
    handleAIResponse(data);
  } catch (err) {
    console.error('Initial greeting error:', err);
    startRecording();
  }
}

function updateCallTimer() {
  const diff = Date.now() - callStartTime;
  const h = Math.floor(diff / 3600000).toString().padStart(2, '0');
  const m = Math.floor((diff % 3600000) / 60000).toString().padStart(2, '0');
  const s = Math.floor((diff % 60000) / 1000).toString().padStart(2, '0');
  document.getElementById('call-timer').textContent = `${h}:${m}:${s}`;
}

async function endCallMode() {
  isCallMode = false;
  clearInterval(callTimerInterval);
  stopRecording();
  
  // Transition to processing then summary
  showScreen('processing');
  runProcessingAnimation(false);
  
  // Wait a bit to simulate processing then end conversation
  setTimeout(() => {
    endConversation();
  }, 2000);
}

function _onScreenEnter(name) {
  if (name === 'admin-dashboard') loadDashboard();
  if (name === 'voice-input')     resetVoiceUI();
  if (name === 'call-mode')       { /* init call specific state */ }
}

let vadState = 'idle'; // 'idle', 'speaking'
let silenceTimer = null;
const VAD_THRESHOLD = 15;
const SILENCE_MS = 1500;

function updateVisualizer() {
  if (!isCallMode || !analyser) return;
  analyser.getByteFrequencyData(dataArray);
  
  let total = 0;
  const bars = document.querySelectorAll('.vis-bar');
  bars.forEach((bar, i) => {
    const val = dataArray[i * 4] || 0;
    total += val;
    const h = Math.max(8, (val / 255) * 40);
    bar.style.height = h + 'px';
    bar.style.opacity = 0.5 + (val / 255) * 0.5;
  });
  
  // VAD logic
  if (isRecording && bars.length > 0) {
    const avg = total / bars.length;
    if (avg > VAD_THRESHOLD) {
      if (vadState === 'idle') vadState = 'speaking';
      if (silenceTimer) {
        clearTimeout(silenceTimer);
        silenceTimer = null;
      }
    } else {
      if (vadState === 'speaking' && !silenceTimer) {
        silenceTimer = setTimeout(() => {
          vadState = 'idle';
          stopRecording(); // Trigger AI response
        }, SILENCE_MS);
      }
    }
  }

  visFrame = requestAnimationFrame(updateVisualizer);
}

// ════════════════════════════════════════════════════════════════
// VOICE RECORDING (MediaRecorder)
// ════════════════════════════════════════════════════════════════

let mediaRecorder    = null;
let audioChunks      = [];
let isRecording      = false;
let conversationHistory = [];
let lastTranscript   = '';
let lastReply        = '';
let lastLeadData     = {};
let lastAudioBase64   = null;

function resetVoiceUI() {
  setVoiceState('idle');
}

function setVoiceState(state) {
  const outer   = document.getElementById('voice-mic-btn');
  const prompt  = document.getElementById('voice-prompt-text');
  const status  = document.getElementById('voice-status-text');

  outer.classList.remove('recording');

  switch (state) {
    case 'idle':
      prompt.textContent = 'Tap the mic and speak';
      if (status) status.textContent = 'AI is ready to listen';
      break;
    case 'recording':
      outer.classList.add('recording');
      prompt.textContent = 'Listening…';
      if (status) status.textContent = 'Tap again to stop';
      break;
    case 'processing':
      prompt.textContent = 'Processing…';
      if (status) status.textContent = 'Sending to AI…';
      break;
  }
}

async function toggleRecording() {
  if (isRecording) {
    stopRecording();
  } else {
    await startRecording();
  }
}

async function startRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    
    // Init visualizer if in call mode
    if (isCallMode) {
      if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();
      analyser = audioContext.createAnalyser();
      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);
      analyser.fftSize = 64;
      dataArray = new Uint8Array(analyser.frequencyBinCount);
      
      vadState = 'idle';
      if (silenceTimer) clearTimeout(silenceTimer);
      silenceTimer = null;
      if (visFrame) cancelAnimationFrame(visFrame);
      
      updateVisualizer();
    }

    audioChunks = [];
    mediaRecorder = new MediaRecorder(stream, { mimeType: getSupportedMimeType() });
    mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunks.push(e.data); };
    mediaRecorder.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      await processAudioChunks();
    };
    mediaRecorder.start(100);
    isRecording = true;
    
    if (isCallMode) {
      document.getElementById('call-ai-status').textContent = 'Listening...';
    } else {
      setVoiceState('recording');
    }
  } catch (err) {
    console.error('Mic error:', err);
    if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
      showScreen('error-voice');
    } else {
      showToast('Microphone error: ' + err.message, 'error');
    }
  }
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
    isRecording = false;
    
    if (isCallMode) {
      document.getElementById('call-ai-status').textContent = 'Processing...';
    } else {
      setVoiceState('processing');
    }
  }
}

function getSupportedMimeType() {
  for (const t of ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg', 'audio/mp4']) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return '';
}

async function processAudioChunks() {
  if (audioChunks.length === 0) { showScreen('error-voice'); return; }

  const blob = new Blob(audioChunks, { type: getSupportedMimeType() || 'audio/webm' });
  // Check if the blob is too small (likely silence)
  if (blob.size < 1000) {
    console.warn('Audio blob too small, likely silence:', blob.size);
    if (isCallMode) {
      // In call mode, just restart recording silently
      startRecording();
      return;
    }
    showScreen('error-voice');
    return;
  }

  const fd = new FormData();
  fd.append('audio', blob, 'recording.webm');
  if (conversationHistory.length) {
    fd.append('conversation_history', JSON.stringify(conversationHistory));
  }

  if (!isCallMode) {
    showScreen('processing');
    runProcessingAnimation(false);
  }

  try {
    const data = await api.post('/api/voice-input', fd, true);
    handleAIResponse(data);
  } catch (err) {
    console.error('Voice input error:', err);
    if (!navigator.onLine || err.message.includes('fetch')) {
      showScreen('error-internet');
    } else {
      // API/backend error — show toast, don't go to error-voice screen
      showToast('AI processing error. Please try again.', 'error');
      if (isCallMode) {
        document.getElementById('call-ai-status').textContent = 'Error — tap to retry';
      } else {
        showScreen('voice-input');
      }
    }
  }
}

async function sendTextMessage() {
  const inp = document.getElementById('text-input-field');
  const msg = inp.value.trim();
  if (!msg) return;
  inp.value = '';
  lastTranscript = msg;

  showScreen('processing');
  runProcessingAnimation(true);

  try {
    const data = await api.post('/api/text-input', {
      message: msg,
      conversation_history: conversationHistory,
    });
    handleAIResponse(data);
  } catch (err) {
    console.error('Text input error:', err);
    if (!navigator.onLine) showScreen('error-internet');
    else { showToast('Error: ' + err.message, 'error'); showScreen('voice-input'); }
  }
}

async function sendChatTextMessage() {
  const inp = document.getElementById('chat-text-input-field');
  const msg = inp.value.trim();
  if (!msg) return;
  inp.value = '';
  lastTranscript = msg;

  showScreen('processing');
  runProcessingAnimation(true);

  try {
    const data = await api.post('/api/text-input', {
      message: msg,
      conversation_history: conversationHistory,
    });
    handleAIResponse(data);
  } catch (err) {
    console.error('Chat text input error:', err);
    if (!navigator.onLine) showScreen('error-internet');
    else { showToast('Error: ' + err.message, 'error'); showScreen('response'); }
  }
}

function handleAIResponse(data) {
  lastTranscript = data.transcript || lastTranscript;
  lastReply      = data.reply_text || '';
  lastLeadData   = data.lead_data  || {};

  conversationHistory.push({ role: 'user',      content: lastTranscript });
  conversationHistory.push({ role: 'assistant', content: lastReply });

  // Update UI based on mode
  if (isCallMode) {
    document.getElementById('call-ai-status').textContent = 'Speaking...';
    showScreen('call-mode');
  } else {
    renderChatHistory();
    updateLeadPreview(lastLeadData);
    showScreen('response');
  }

  // Play audio response — ElevenLabs first, then browser speechSynthesis fallback
  lastAudioBase64 = data.audio_base64 || null;
  if (lastAudioBase64) {
    playBase64Audio(lastAudioBase64);
  } else if (lastReply && 'speechSynthesis' in window) {
    // No ElevenLabs audio — use browser TTS as fallback
    playSpeechSynthesisFallback(lastReply);
  } else if (isCallMode) {
    // No audio at all in call mode — restart recording after a pause
    setTimeout(() => {
      document.getElementById('call-ai-status').textContent = 'Listening...';
      startRecording();
    }, 1000);
  }
}

function renderChatHistory() {
  const container = document.getElementById('chat-messages');
  if (!container) return;
  container.innerHTML = '';
  
  conversationHistory.forEach((msg, index) => {
    if (msg.role === 'user') {
      container.innerHTML += `
      <div class="chat-row user-row">
        <div class="chat-bubble user-bubble">
          <p>${escapeHtml(msg.content)}</p>
        </div>
        <div class="chat-avatar user-avatar">
          <svg viewBox="0 0 24 24" fill="white" width="14" height="14">
            <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z" />
          </svg>
        </div>
      </div>
      `;
    } else if (msg.role === 'assistant') {
      const isLast = index === conversationHistory.length - 1;
      let playBtn = '';
      if (isLast) {
        playBtn = `
          <button class="btn-play-voice" id="btn-play-response" onclick="playVoiceResponse()">
            <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14">
              <path fill-rule="evenodd" d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.707.707L4.586 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.586l3.707-3.707a1 1 0 011.09-.217zM14.657 2.929a1 1 0 011.414 0A9.972 9.972 0 0119 10a9.972 9.972 0 01-2.929 7.071 1 1 0 01-1.414-1.414A7.971 7.971 0 0017 10c0-2.21-.894-4.208-2.343-5.657a1 1 0 010-1.414zm-2.829 2.828a1 1 0 011.415 0A5.983 5.983 0 0115 10a5.984 5.984 0 01-1.757 4.243 1 1 0 01-1.415-1.415A3.984 3.984 0 0013 10a3.983 3.983 0 00-1.172-2.828 1 1 0 010-1.415z" clip-rule="evenodd" />
            </svg>
            Play voice response
            <span class="btn-play-sparkle">✦</span>
          </button>
        `;
      }
      container.innerHTML += `
      <div class="chat-row ai-row">
        <div class="chat-avatar ai-avatar-icon">
          <svg viewBox="0 0 24 24" fill="white" width="14" height="14">
            <path fill-rule="evenodd" d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" clip-rule="evenodd" />
          </svg>
        </div>
        <div class="chat-bubble ai-bubble">
          <p>${escapeHtml(msg.content)}</p>
          ${playBtn}
          <p class="ai-generated-label">⚡ Generated by AI</p>
        </div>
      </div>
      `;
    }
  });

  // Scroll the screen to bottom
  const screen = document.getElementById('screen-response');
  if (screen) {
    setTimeout(() => { screen.scrollTop = screen.scrollHeight; }, 50);
  }
}

function playBase64Audio(base64) {
  const audio = new Audio("data:audio/mpeg;base64," + base64);
  audio.onended = () => {
    if (isCallMode) {
      document.getElementById('call-ai-status').textContent = 'Listening...';
      startRecording();
    }
  };
  audio.onerror = () => {
    console.warn('Base64 audio playback error — falling back to speechSynthesis');
    if (lastReply && 'speechSynthesis' in window) {
      playSpeechSynthesisFallback(lastReply);
    } else if (isCallMode) {
      setTimeout(() => {
        document.getElementById('call-ai-status').textContent = 'Listening...';
        startRecording();
      }, 1000);
    }
  };
  audio.play().catch(err => {
    console.warn('Audio autoplay blocked:', err.name);
    // If autoplay blocked, fall back to speechSynthesis (doesn't need gesture in most cases)
    if (lastReply && 'speechSynthesis' in window) {
      playSpeechSynthesisFallback(lastReply);
    } else if (isCallMode) {
      setTimeout(() => {
        document.getElementById('call-ai-status').textContent = 'Listening...';
        startRecording();
      }, 1000);
    }
  });
}

function playSpeechSynthesisFallback(text) {
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 0.95;
  u.lang = 'en-US';
  u.onend = () => {
    if (isCallMode) {
      document.getElementById('call-ai-status').textContent = 'Listening...';
      startRecording();
    }
  };
  u.onerror = () => {
    if (isCallMode) {
      setTimeout(() => {
        document.getElementById('call-ai-status').textContent = 'Listening...';
        startRecording();
      }, 1000);
    }
  };
  window.speechSynthesis.speak(u);
}

// ════════════════════════════════════════════════════════════════
// PROCESSING ANIMATION
// ════════════════════════════════════════════════════════════════

function runProcessingAnimation(skipSTT) {
  const steps = [
    { dot: 'step-stt-dot', label: 'step-stt-label' },
    { dot: 'step-nlp-dot', label: 'step-nlp-label' },
    { dot: 'step-ai-dot',  label: 'step-ai-label'  },
  ];

  // Reset all
  steps.forEach(s => {
    const d = document.getElementById(s.dot);
    if (d) { d.className = 'proc-step-dot'; }
  });

  const startIdx = skipSTT ? 1 : 0;
  if (skipSTT) {
    const d = document.getElementById('step-stt-dot');
    if (d) d.classList.add('done');
  }

  let delay = 0;
  for (let i = startIdx; i < steps.length; i++) {
    const stepDelay = delay;
    const dotId = steps[i].dot;
    setTimeout(() => {
      const d = document.getElementById(dotId);
      if (d) { d.classList.remove('done'); d.classList.add('active'); }
    }, stepDelay);
    delay += 900;
    setTimeout(() => {
      const d = document.getElementById(dotId);
      if (d) { d.classList.remove('active'); d.classList.add('done'); }
    }, delay);
  }
}

// ════════════════════════════════════════════════════════════════
// RESPONSE SCREEN
// ════════════════════════════════════════════════════════════════

function updateLeadPreview(lead) {
  const bar     = document.getElementById('lead-preview');
  const content = document.getElementById('lead-preview-content');
  const fields  = [
    ['Name', lead.name], ['Email', lead.email],
    ['Phone', lead.phone], ['Interest', lead.product_interest],
  ].filter(([, v]) => v);

  if (!fields.length) { bar.style.display = 'none'; return; }

  content.innerHTML = fields.map(([k, v]) =>
    `<span style="font-weight:600;color:#059669">${k}:</span> ${escapeHtml(v)}&nbsp;&nbsp;`
  ).join('');
  bar.style.display = 'flex';
}

function continueConversation() { showScreen('voice-input'); }

async function endConversation() {
  const btn = document.getElementById('btn-end-convo');
  btn.textContent = 'Saving…';
  btn.disabled = true;

  try {
    const summary = conversationHistory
      .map(m => `${m.role === 'user' ? 'You' : 'AI'}: ${m.content}`).join('\n');
    await api.post('/api/end-conversation', {
      lead_data: lastLeadData,
      conversation_summary: summary,
      source_channel: 'web',
    });
    showToast('Lead saved! Emails sent.', 'success');
    setTimeout(() => showScreen('landing'), 1500);
  } catch (err) {
    showToast('Save failed: ' + err.message, 'error');
    btn.textContent = 'End & Save Lead';
    btn.disabled = false;
  }
}

function playVoiceResponse() {
  const btn = document.getElementById('btn-play-response');
  
  if (lastAudioBase64) {
    playBase64Audio(lastAudioBase64);
    return;
  }

  if (!lastReply || !('speechSynthesis' in window)) {
    showToast('Voice synthesis not supported.', 'error');
    return;
  }
  
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(lastReply);
  u.rate = 0.95; u.lang = 'en-US';
  u.onstart = () => { btn.innerHTML = `<svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14"><path d="M5.5 3.5A1.5 1.5 0 017 5v10a1.5 1.5 0 01-3 0V5a1.5 1.5 0 011.5-1.5zm7 0A1.5 1.5 0 0114 5v10a1.5 1.5 0 01-3 0V5a1.5 1.5 0 011.5-1.5z"/></svg> Stop`; };
  u.onend = u.onerror = () => {
    btn.innerHTML = `<svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14"><path fill-rule="evenodd" d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.707.707L4.586 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.586l3.707-3.707a1 1 0 011.09-.217zM14.657 2.929a1 1 0 011.414 0A9.972 9.972 0 0119 10a9.972 9.972 0 01-2.929 7.071 1 1 0 01-1.414-1.414A7.971 7.971 0 0017 10c0-2.21-.894-4.208-2.343-5.657a1 1 0 010-1.414zm-2.829 2.828a1 1 0 011.415 0A5.983 5.983 0 0115 10a5.984 5.984 0 01-1.757 4.243 1 1 0 01-1.415-1.415A3.984 3.984 0 0013 10a3.983 3.983 0 00-1.172-2.828 1 1 0 010-1.415z" clip-rule="evenodd"/></svg> Play voice response <span class="btn-play-sparkle">✦</span>`;
  };
  window.speechSynthesis.speak(u);
}

// ════════════════════════════════════════════════════════════════
// ERROR HANDLING
// ════════════════════════════════════════════════════════════════

function retryFromError(type) {
  if (type === 'internet') showScreen('voice-input');
  else if (type === 'voice') showScreen('voice-input');
}

// ════════════════════════════════════════════════════════════════
// ADMIN AUTH
// ════════════════════════════════════════════════════════════════

async function userLogin(e) {
  e.preventDefault();
  const username = document.getElementById('user-username').value.trim();
  const password = document.getElementById('user-password').value;
  const errEl    = document.getElementById('user-login-error');
  const btnText  = document.getElementById('user-login-btn-text');
  const spinner  = document.getElementById('user-login-spinner');

  errEl.style.display = 'none';
  btnText.style.display = 'none';
  spinner.style.display = 'block';

  try {
    const body = new URLSearchParams({ username, password });
    const data = await api.post('/api/admin/login', body, true);
    api.token = data.access_token;
    sessionStorage.setItem('vocaldesk_token', data.access_token);
    showToast(`Welcome, ${data.username}!`, 'success');
    
    if (data.role === 'admin' || data.role === 'staff') {
      showScreen('admin-dashboard');
    } else {
      showScreen('landing');
    }
  } catch (err) {
    errEl.textContent = 'Incorrect username or password. Please try again.';
    errEl.style.display = 'block';
  } finally {
    btnText.style.display = 'block';
    spinner.style.display = 'none';
  }
}

async function adminLogin(e) {
  e.preventDefault();
  const username = document.getElementById('admin-username').value.trim();
  const password = document.getElementById('admin-password').value;
  const errEl    = document.getElementById('login-error');
  const btnText  = document.getElementById('login-btn-text');
  const spinner  = document.getElementById('login-spinner');

  errEl.style.display = 'none';
  btnText.style.display = 'none';
  spinner.style.display = 'block';

  try {
    const body = new URLSearchParams({ username, password });
    const data = await api.post('/api/admin/login', body, true);
    api.token = data.access_token;
    sessionStorage.setItem('vocaldesk_token', data.access_token);
    showToast(`Welcome, ${data.username}!`, 'success');
    
    if (data.role === 'admin' || data.role === 'staff') {
      showScreen('admin-dashboard');
    } else {
      showScreen('landing');
    }
  } catch (err) {
    errEl.textContent = 'Incorrect username or password. Please try again.';
    errEl.style.display = 'block';
  } finally {
    btnText.style.display = 'block';
    spinner.style.display = 'none';
  }
}

async function handleSignup(e) {
  e.preventDefault();
  const username = document.getElementById('signup-username').value.trim();
  const email    = document.getElementById('signup-email').value.trim();
  const password = document.getElementById('signup-password').value;
  const errEl    = document.getElementById('signup-error');
  const btn      = document.getElementById('btn-signup-submit');

  errEl.style.display = 'none';
  btn.textContent = 'Signing Up...';
  btn.disabled = true;

  try {
    const body = { username, email, password };
    await api.post('/api/admin/signup', body);
    
    // Automatically log the user in after successful signup
    const loginBody = new URLSearchParams({ username, password });
    const loginData = await api.post('/api/admin/login', loginBody, true);
    api.token = loginData.access_token;
    sessionStorage.setItem('vocaldesk_token', loginData.access_token);
    
    showToast('Account created successfully!', 'success');
    showScreen('landing');
  } catch (err) {
    errEl.textContent = 'Signup failed: ' + err.message;
    errEl.style.display = 'block';
  } finally {
    btn.textContent = 'Sign Up';
    btn.disabled = false;
  }
}

async function adminRegister(e) {
  e.preventDefault();
  const username = document.getElementById('reg-username').value.trim();
  const email    = document.getElementById('reg-email').value.trim();
  const password = document.getElementById('reg-password').value;
  const errEl    = document.getElementById('register-error');

  errEl.style.display = 'none';
  try {
    await api.post('/api/admin/register', { username, email, password });
    showToast('Registration successful! Please login.', 'success');
    showScreen('admin-login');
  } catch (err) {
    errEl.textContent = 'Registration failed: ' + err.message;
    errEl.style.display = 'block';
  }
}

async function adminResetPassword(e) {
  e.preventDefault();
  const username = document.getElementById('reset-username').value.trim();
  const new_password = document.getElementById('reset-password-val').value;
  const errEl    = document.getElementById('reset-error');

  errEl.style.display = 'none';
  try {
    await api.post('/api/admin/password-reset', { username, new_password });
    showToast('Password updated! Please login.', 'success');
    showScreen('admin-login');
  } catch (err) {
    errEl.textContent = 'Reset failed: ' + err.message;
    errEl.style.display = 'block';
  }
}

function adminLogout() {
  api.token = null;
  sessionStorage.removeItem('vocaldesk_token');
  showToast('Logged out successfully.', 'success');
  showScreen('landing');
}

// ════════════════════════════════════════════════════════════════
// ADMIN DASHBOARD
// ════════════════════════════════════════════════════════════════

let currentDashboardLeads = [];
let dashChartsInit = false;

async function loadDashboard() {
  if (!api.token) { showScreen('admin-login'); return; }

  try {
    // Parallel fetch for stats and detailed analytics
    const [stats, analytics] = await Promise.all([
      api.get('/api/leads/stats'),
      api.get('/api/analytics/summary').catch(() => ({}))
    ]);

    document.getElementById('stat-total').textContent    = stats.total_leads   ?? '0';
    document.getElementById('stat-web').textContent      = stats.web_leads     ?? '0';
    document.getElementById('stat-whatsapp').textContent = stats.whatsapp_leads ?? '0';

    // Topbar lead count
    const dbCount = document.getElementById('db-lead-count');
    if (dbCount) dbCount.textContent = stats.total_leads ?? '0';

    // Update response time from analytics if available
    if (analytics.ai_metrics && analytics.ai_metrics.length) {
      const latestLatency = analytics.ai_metrics.find(m => m.metric_name === 'api_latency');
      if (latestLatency) {
        const el = document.getElementById('stat-latency');
        if (el) el.textContent = latestLatency.metric_value.toFixed(1) + 's';
      }
    }

    currentDashboardLeads = stats.recent_leads || [];
    renderRecentActivity(currentDashboardLeads);
    loadLeadsTable(currentDashboardLeads);
    loadConversationList(currentDashboardLeads);

    // Init charts once
    if (!dashChartsInit) { initDashCharts(); dashChartsInit = true; }
  } catch (err) {
    if (err.message.includes('401') || err.message.includes('credentials')) adminLogout();
    else showToast('Dashboard load failed: ' + err.message, 'error');
  }
}

function renderRecentActivity(leads) {
  const list = document.getElementById('recent-activity-list');
  if (!leads.length) {
    list.innerHTML = '<div class="activity-loading">No leads yet. Start a conversation!</div>';
    return;
  }
  list.innerHTML = leads.map(l => {
    const name   = escapeHtml(l.name || 'Anonymous');
    const action = escapeHtml(l.product_interest || 'Started conversation');
    const ch     = l.source_channel === 'whatsapp' ? '💬 WhatsApp' : '🌐 Web';
    return `
      <div class="activity-item clickable" onclick="openLead('${l.id}')">
        <div class="activity-dot"></div>
        <div>
          <div class="activity-name">${name} <span style="font-weight:400;font-size:0.72rem;color:var(--teal)">${ch}</span></div>
          <div class="activity-action">${action}</div>
        </div>
      </div>`;
  }).join('');
}

function openLead(id) {
  const lead = currentDashboardLeads.find(l => l.id === id);
  if (!lead) return;

  document.getElementById('modal-lead-name').textContent = lead.name || 'Anonymous';
  document.getElementById('modal-lead-email').textContent = lead.email || '—';
  document.getElementById('modal-lead-phone').textContent = lead.phone || '—';
  document.getElementById('modal-lead-source').textContent = lead.source_channel === 'whatsapp' ? 'WhatsApp' : 'Web';
  document.getElementById('modal-lead-interest').textContent = lead.product_interest || '—';
  document.getElementById('modal-lead-summary').textContent = lead.conversation_summary || '—';

  const modal = document.getElementById('lead-modal');
  if (modal) modal.classList.add('active');
}

function closeLeadModal() {
  const modal = document.getElementById('lead-modal');
  if (modal) modal.classList.remove('active');
}

// ═══ Dashboard Tab Navigation ═══

const TAB_TITLES = {
  overview:      'Overview',
  conversations: 'Conversations',
  voicecalls:    'Voice Calls',
  analytics:     'Analytics',
  leads:         'Lead Database',
};

function goTab(tabId, btn) {
  // Hide all tabs
  document.querySelectorAll('.db-tab').forEach(t => t.classList.remove('active'));
  // Deactivate all nav buttons
  document.querySelectorAll('.db-nav-btn').forEach(b => b.classList.remove('active'));

  // Show target tab
  const tab = document.getElementById('tab-' + tabId);
  if (tab) tab.classList.add('active');
  // Activate nav button
  if (btn) btn.classList.add('active');

  // Update topbar title
  const title = document.getElementById('db-page-title');
  if (title) title.textContent = TAB_TITLES[tabId] || tabId;
}

// ═══ Leads Table ═══

function loadLeadsTable(leads) {
  const tbody = document.getElementById('db-leadsTableBody');
  const badge = document.getElementById('db-lead-badge');
  if (!tbody) return;

  if (badge) badge.textContent = (leads.length || 0) + ' leads';

  if (!leads.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--text-muted)">No leads yet. Start a voice conversation to capture leads!</td></tr>';
    return;
  }

  tbody.innerHTML = leads.map((l, i) => {
    const src = l.source_channel === 'whatsapp'
      ? '<span class="db-chip db-chip-green">WhatsApp</span>'
      : '<span class="db-chip db-chip-blue">Web</span>';
    return `<tr>
      <td style="color:var(--text-muted)">#${l.id || i+1}</td>
      <td style="font-weight:600">${escapeHtml(l.name || 'Anonymous')}</td>
      <td>${escapeHtml(l.email || '—')}</td>
      <td>${src}</td>
      <td style="text-align:right">${escapeHtml(l.product_interest || '—')}</td>
      <td style="text-align:right"><span class="db-chip db-chip-teal">Captured</span></td>
    </tr>`;
  }).join('');
}

// ═══ Conversation List ═══

function loadConversationList(leads) {
  const list = document.getElementById('db-convList');
  if (!list) return;

  if (!leads.length) {
    list.innerHTML = '<p style="font-size:12px;color:var(--text-muted);text-align:center;padding:20px">No active sessions yet.</p>';
    return;
  }

  list.innerHTML = leads.map(l => {
    const initials = (l.name || 'A').slice(0,2).toUpperCase();
    return `<div class="db-ci" onclick="selectConversation('${l.id}')">
      <div class="db-chat-av">${initials}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:12px;font-weight:600;color:var(--text-primary)">${escapeHtml(l.name || 'Anonymous')}</div>
        <div style="font-size:10px;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(l.product_interest || 'Sales inquiry')}</div>
      </div>
    </div>`;
  }).join('');
}

function selectConversation(id) {
  const lead = currentDashboardLeads.find(l => l.id === id);
  if (!lead) return;

  // Highlight selected
  document.querySelectorAll('.db-ci').forEach(c => c.classList.remove('sel'));
  event.currentTarget.classList.add('sel');

  // Update chat header
  const initials = (lead.name || 'A').slice(0,2).toUpperCase();
  document.getElementById('db-chatAv').textContent = initials;
  document.getElementById('db-chatName').textContent = lead.name || 'Anonymous';
  document.getElementById('db-chatSub').textContent = lead.email || (lead.source_channel === 'whatsapp' ? 'WhatsApp Lead' : 'Web Lead');

  // Render conversation summary as chat bubbles
  const box = document.getElementById('db-chatBox');
  const summary = lead.conversation_summary || 'No transcript recorded.';
  box.innerHTML = `
    <div class="db-msg-label r">User</div>
    <div class="db-msg db-msg-u">${escapeHtml(lead.product_interest || 'Sales inquiry')}</div>
    <div class="db-msg-label">VocalDesk AI</div>
    <div class="db-msg db-msg-b">${escapeHtml(summary)}</div>
  `;
}

// ═══ Chart.js Dashboard Charts ═══

function initDashCharts() {
  if (typeof Chart === 'undefined') { console.warn('Chart.js not loaded'); return; }

  const tealRgba = 'rgba(0,169,165,';
  const defFont = { family: "'Inter','Segoe UI',sans-serif", size: 11, color: '#94a3b8' };

  const gridOpts = { color: 'rgba(255,255,255,0.06)', drawBorder: false };
  const tickOpts = { font: { size: 10 }, color: '#cbd5e1', padding: 6 };

  // Hourly Activity (Overview tab)
  const hCtx = document.getElementById('hourlyChart');
  if (hCtx) {
    new Chart(hCtx, {
      type: 'bar',
      data: {
        labels: ['9am','10am','11am','12pm','1pm','2pm','3pm','4pm','5pm','6pm','7pm','8pm'],
        datasets: [{
          data: [3,5,8,12,7,10,14,9,6,4,2,1],
          backgroundColor: tealRgba + '0.6)',
          borderRadius: 4,
          barThickness: 18,
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true, grid: gridOpts, ticks: tickOpts }, x: { grid: { display: false }, ticks: tickOpts } }
      }
    });
  }

  // Weekly Call Volume (Voice Calls tab)
  const wCtx = document.getElementById('weeklyChart');
  if (wCtx) {
    new Chart(wCtx, {
      type: 'bar',
      data: {
        labels: ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'],
        datasets: [{
          data: [4,7,5,9,6,2,1],
          backgroundColor: tealRgba + '0.55)',
          borderRadius: 4,
          barThickness: 28,
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true, grid: gridOpts, ticks: tickOpts }, x: { grid: { display: false }, ticks: tickOpts } }
      }
    });
  }

  // Lead Conversion Trend (Analytics tab)
  const rCtx = document.getElementById('revenueChart');
  if (rCtx) {
    new Chart(rCtx, {
      type: 'line',
      data: {
        labels: ['Day 1','Day 2','Day 3','Day 4','Day 5','Day 6','Day 7'],
        datasets: [{
          data: [2,5,3,8,6,10,7],
          borderColor: 'rgb(0,169,165)',
          backgroundColor: tealRgba + '0.08)',
          fill: true,
          tension: 0.4,
          pointRadius: 4,
          pointBackgroundColor: 'rgb(0,169,165)',
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true, grid: gridOpts, ticks: tickOpts }, x: { grid: { display: false }, ticks: tickOpts } }
      }
    });
  }
}

// ════════════════════════════════════════════════════════════════
// TOAST
// ════════════════════════════════════════════════════════════════

let toastTimer = null;

function showToast(msg, type = 'info') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `toast toast-${type} show`;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3000);
}

// ════════════════════════════════════════════════════════════════
// UTILS
// ════════════════════════════════════════════════════════════════

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ════════════════════════════════════════════════════════════════
// INIT
// ════════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
  initParticles();

  // Restore session token
  const token = sessionStorage.getItem('vocaldesk_token');
  if (token) api.token = token;

  // Keyboard for voice mic
  const micBtn = document.getElementById('voice-mic-btn');
  if (micBtn) {
    micBtn.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleRecording(); }
    });
  }

  // Keyboard for landing mic
  const heroMic = document.getElementById('btn-hero-mic');
  if (heroMic) {
    heroMic.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showScreen('voice-input'); }
    });
  }
});

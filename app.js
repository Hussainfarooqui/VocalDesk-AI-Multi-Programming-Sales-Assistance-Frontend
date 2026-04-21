/**
 * VocalDesk – SPA App Logic
 * Screen routing · MediaRecorder · API client · Admin auth · Dashboard
 */

'use strict';

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

const API_BASE = window.location.origin;

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

let _prevScreen = 'landing';

function showScreen(name) {
  const cur = document.querySelector('.screen.active');
  if (cur) {
    _prevScreen = cur.id.replace('screen-', '');
    cur.classList.remove('active');
  }
  const next = document.getElementById(`screen-${name}`);
  if (next) {
    next.classList.add('active');
    next.scrollTop = 0;
    _onScreenEnter(name);
  }
}

function _onScreenEnter(name) {
  if (name === 'admin-dashboard') loadDashboard();
  if (name === 'voice-input')     resetVoiceUI();
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
    audioChunks = [];
    mediaRecorder = new MediaRecorder(stream, { mimeType: getSupportedMimeType() });
    mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunks.push(e.data); };
    mediaRecorder.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      await processAudioChunks();
    };
    mediaRecorder.start(100);
    isRecording = true;
    setVoiceState('recording');
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
    setVoiceState('processing');
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
  const fd = new FormData();
  fd.append('audio', blob, 'recording.webm');

  showScreen('processing');
  runProcessingAnimation(false);

  try {
    const data = await api.post('/api/voice-input', fd, true);
    handleAIResponse(data);
  } catch (err) {
    console.error('Voice input error:', err);
    if (!navigator.onLine || err.message.includes('fetch')) {
      showScreen('error-internet');
    } else {
      showScreen('error-voice');
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

function handleAIResponse(data) {
  lastTranscript = data.transcript || lastTranscript;
  lastReply      = data.reply_text || '';
  lastLeadData   = data.lead_data  || {};

  conversationHistory.push({ role: 'user',      content: lastTranscript });
  conversationHistory.push({ role: 'assistant', content: lastReply });

  document.getElementById('response-transcript').textContent = lastTranscript;
  document.getElementById('response-ai-text').textContent    = lastReply;

  updateLeadPreview(lastLeadData);
  showScreen('response');
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
  if (!lastReply || !('speechSynthesis' in window)) {
    showToast('Voice synthesis not supported.', 'error');
    return;
  }
  const btn = document.getElementById('btn-play-response');
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
    showScreen('admin-dashboard');
  } catch (err) {
    errEl.textContent = 'Incorrect username or password. Please try again.';
    errEl.style.display = 'block';
  } finally {
    btnText.style.display = 'block';
    spinner.style.display = 'none';
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

async function loadDashboard() {
  if (!api.token) { showScreen('admin-login'); return; }

  try {
    const stats = await api.get('/api/leads/stats');
    document.getElementById('stat-total').textContent    = stats.total_leads   ?? '—';
    document.getElementById('stat-web').textContent      = stats.web_leads     ?? '—';
    document.getElementById('stat-whatsapp').textContent = stats.whatsapp_leads ?? '—';
    renderRecentActivity(stats.recent_leads || []);
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
      <div class="activity-item">
        <div class="activity-dot"></div>
        <div>
          <div class="activity-name">${name} <span style="font-weight:400;font-size:0.72rem;color:var(--teal)">${ch}</span></div>
          <div class="activity-action">${action}</div>
        </div>
      </div>`;
  }).join('');
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

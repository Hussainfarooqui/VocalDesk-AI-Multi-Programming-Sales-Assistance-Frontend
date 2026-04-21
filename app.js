/**
 * VocalDesk – SPA Application Logic (Phase 11: Full API Integration)
 * Handles: screen routing, MediaRecorder, API calls, admin auth, lead management
 */

'use strict';

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

let _previousScreen = 'landing';

function showScreen(name) {
  const current = document.querySelector('.screen.active');
  if (current) {
    _previousScreen = current.id.replace('screen-', '');
    current.classList.remove('active');
  }
  const next = document.getElementById(`screen-${name}`);
  if (next) {
    next.classList.add('active');
    // Auto-scroll to top
    next.scrollTop = 0;
    // Screen-specific onEnter hooks
    _onScreenEnter(name);
  }
}

function goBack() {
  showScreen(_previousScreen);
}

function _onScreenEnter(name) {
  if (name === 'admin-dashboard') {
    loadDashboard();
  }
  if (name === 'voice-input') {
    resetVoiceUI();
  }
}

// ════════════════════════════════════════════════════════════════
// VOICE RECORDING (MediaRecorder)
// ════════════════════════════════════════════════════════════════

let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;
let conversationHistory = [];   // Maintained per session
let lastTranscript = '';
let lastReply = '';
let lastLeadData = {};

function resetVoiceUI() {
  setVoiceState('idle');
  conversationHistory = [];
  lastTranscript = '';
  lastReply = '';
  lastLeadData = {};
}

function setVoiceState(state) {
  const micBtn = document.getElementById('voice-mic-btn');
  const promptText = document.getElementById('voice-prompt-text');
  const statusText = document.getElementById('voice-status-text');

  micBtn.classList.remove('recording');

  switch (state) {
    case 'idle':
      promptText.textContent = 'Tap the mic and speak';
      statusText.textContent = 'AI is ready to listen';
      break;
    case 'recording':
      micBtn.classList.add('recording');
      promptText.textContent = 'Listening…';
      statusText.textContent = 'Tap again to stop recording';
      break;
    case 'processing':
      promptText.textContent = 'Processing…';
      statusText.textContent = 'Sending to AI engine';
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

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunks.push(e.data);
    };

    mediaRecorder.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      await processAudioChunks();
    };

    mediaRecorder.start(100);
    isRecording = true;
    setVoiceState('recording');

  } catch (err) {
    console.error('Mic access error:', err);
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
  const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg', 'audio/mp4'];
  for (const type of types) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return '';
}

async function processAudioChunks() {
  if (audioChunks.length === 0) {
    showScreen('error-voice');
    return;
  }

  const blob = new Blob(audioChunks, { type: getSupportedMimeType() || 'audio/webm' });
  const formData = new FormData();
  formData.append('audio', blob, 'recording.webm');

  // Show processing screen with animated steps
  showScreen('processing');
  animateProcessingSteps();

  try {
    const data = await api.post('/api/voice-input', formData, true);
    handleAIResponse(data);
  } catch (err) {
    console.error('Voice input error:', err);
    if (err.message.includes('fetch') || err.message.includes('NetworkError')) {
      showScreen('error-internet');
    } else {
      showScreen('error-voice');
    }
  }
}

async function sendTextMessage() {
  const input = document.getElementById('text-input-field');
  const message = input.value.trim();
  if (!message) return;

  input.value = '';
  lastTranscript = message;

  showScreen('processing');
  animateProcessingStepsText();

  try {
    const data = await api.post('/api/text-input', {
      message,
      conversation_history: conversationHistory,
    });
    handleAIResponse(data);
  } catch (err) {
    console.error('Text input error:', err);
    if (err.message.includes('fetch') || err.message.includes('NetworkError')) {
      showScreen('error-internet');
    } else {
      showToast('Error: ' + err.message, 'error');
      showScreen('voice-input');
    }
  }
}

function handleAIResponse(data) {
  lastTranscript = data.transcript || lastTranscript;
  lastReply = data.reply_text || '';
  lastLeadData = data.lead_data || {};

  // Maintain conversation history
  conversationHistory.push({ role: 'user', content: lastTranscript });
  conversationHistory.push({ role: 'assistant', content: lastReply });

  // Update response screen
  document.getElementById('response-transcript').textContent = lastTranscript;
  document.getElementById('response-ai-text').textContent = lastReply;

  // Show lead preview if any data was captured
  updateLeadPreview(lastLeadData);

  showScreen('response');
}

// ════════════════════════════════════════════════════════════════
// PROCESSING SCREEN ANIMATION
// ════════════════════════════════════════════════════════════════

function animateProcessingSteps() {
  _runStepAnimation(['step-stt', 'step-nlp', 'step-ai'], [800, 1200, 800]);
}

function animateProcessingStepsText() {
  // Text input: skip STT step
  const sttEl = document.getElementById('step-stt');
  sttEl.classList.add('step-done');
  document.getElementById('step-stt-status').innerHTML = '<span class="step-check">✓</span>';
  _runStepAnimation(['step-nlp', 'step-ai'], [800, 800], 0);
}

function _runStepAnimation(stepIds, durations, startIndex = 0) {
  // Reset all steps
  stepIds.forEach((id, i) => {
    const el = document.getElementById(id);
    if (el) {
      el.classList.remove('step-active', 'step-done', 'step-pending');
      el.classList.add(i === 0 && startIndex === 0 ? 'step-active' : 'step-pending');
      const statusEl = document.getElementById(id + '-status');
      if (statusEl) statusEl.innerHTML = i === 0 && startIndex === 0
        ? '<div class="step-spinner"></div>'
        : '—';
    }
  });

  let delay = 0;
  stepIds.forEach((id, i) => {
    const dur = durations[i] || 800;
    setTimeout(() => {
      const el = document.getElementById(id);
      if (el) {
        el.classList.remove('step-pending');
        el.classList.add('step-active');
        const statusEl = document.getElementById(id + '-status');
        if (statusEl) statusEl.innerHTML = '<div class="step-spinner"></div>';
      }
    }, delay);

    delay += dur;

    setTimeout(() => {
      const el = document.getElementById(id);
      if (el) {
        el.classList.remove('step-active');
        el.classList.add('step-done');
        const statusEl = document.getElementById(id + '-status');
        if (statusEl) statusEl.innerHTML = '<span class="step-check">✓</span>';
      }
    }, delay);
  });
}

// ════════════════════════════════════════════════════════════════
// RESPONSE SCREEN
// ════════════════════════════════════════════════════════════════

function updateLeadPreview(leadData) {
  const preview = document.getElementById('lead-preview');
  const content = document.getElementById('lead-preview-content');

  const fields = [
    ['Name', leadData.name],
    ['Email', leadData.email],
    ['Phone', leadData.phone],
    ['Interest', leadData.product_interest],
  ].filter(([_, v]) => v);

  if (fields.length === 0) {
    preview.style.display = 'none';
    return;
  }

  content.innerHTML = fields.map(([k, v]) =>
    `<div class="lead-row"><span class="lead-key">${k}</span><span class="lead-val">${v}</span></div>`
  ).join('');
  preview.style.display = 'block';
}

function continueConversation() {
  showScreen('voice-input');
}

async function endConversation() {
  const btn = document.getElementById('btn-end-convo');
  btn.textContent = 'Saving…';
  btn.disabled = true;

  try {
    const summary = conversationHistory
      .map(m => `${m.role === 'user' ? 'User' : 'AI'}: ${m.content}`)
      .join('\n');

    await api.post('/api/end-conversation', {
      lead_data: lastLeadData,
      conversation_summary: summary,
      source_channel: 'web',
    });

    showToast('Lead saved! Thank you email sent.', 'success');
    setTimeout(() => showScreen('landing'), 1500);
  } catch (err) {
    console.error('End conversation error:', err);
    showToast('Save failed: ' + err.message, 'error');
    btn.textContent = 'End & Save Lead';
    btn.disabled = false;
  }
}

function playVoiceResponse() {
  if (!lastReply) return;
  const btn = document.getElementById('btn-play-response');
  const icon = document.getElementById('play-icon');

  // Use browser TTS as fallback (no server TTS in v2 architecture)
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(lastReply);
    utter.rate = 0.95;
    utter.pitch = 1;
    utter.lang = 'en-US';

    utter.onstart = () => {
      icon.textContent = '⏹';
      btn.textContent = '';
      btn.innerHTML = '<span id="play-icon">⏹</span> Stop';
    };
    utter.onend = utter.onerror = () => {
      icon.textContent = '▶';
      btn.innerHTML = '<span id="play-icon">▶</span> Play voice response';
    };

    window.speechSynthesis.speak(utter);
  } else {
    showToast('Voice synthesis not supported in your browser.', 'error');
  }
}

// ════════════════════════════════════════════════════════════════
// ERROR STATES
// ════════════════════════════════════════════════════════════════

function retryFromError(type) {
  if (type === 'internet') {
    showScreen('voice-input');
  } else if (type === 'voice') {
    showScreen('voice-input');
  }
}

// ════════════════════════════════════════════════════════════════
// ADMIN AUTH
// ════════════════════════════════════════════════════════════════

async function adminLogin(e) {
  e.preventDefault();

  const username = document.getElementById('admin-username').value.trim();
  const password = document.getElementById('admin-password').value;
  const errorEl = document.getElementById('login-error');
  const btnText = document.getElementById('login-btn-text');
  const spinner = document.getElementById('login-spinner');

  errorEl.style.display = 'none';
  btnText.style.display = 'none';
  spinner.style.display = 'block';

  try {
    // Use form-encoded body as required by OAuth2PasswordRequestForm
    const formBody = new URLSearchParams({ username, password });
    const data = await api.post('/api/admin/login', formBody, true);

    api.token = data.access_token;
    sessionStorage.setItem('vocaldesk_token', data.access_token);

    showToast(`Welcome, ${data.username}!`, 'success');
    showScreen('admin-dashboard');

  } catch (err) {
    errorEl.textContent = err.message === 'Incorrect username or password'
      ? 'Incorrect username or password. Please try again.'
      : `Login failed: ${err.message}`;
    errorEl.style.display = 'block';
  } finally {
    btnText.style.display = 'block';
    spinner.style.display = 'none';
  }
}

function adminLogout() {
  api.token = null;
  sessionStorage.removeItem('vocaldesk_token');
  showToast('Logged out.', 'success');
  showScreen('landing');
}

function togglePasswordVisibility() {
  const input = document.getElementById('admin-password');
  input.type = input.type === 'password' ? 'text' : 'password';
}

// ════════════════════════════════════════════════════════════════
// ADMIN DASHBOARD
// ════════════════════════════════════════════════════════════════

async function loadDashboard() {
  // Check auth
  if (!api.token) {
    showScreen('admin-login');
    return;
  }

  document.getElementById('dash-subtitle').textContent = 'Loading…';

  try {
    const stats = await api.get('/api/leads/stats');

    document.getElementById('stat-total').textContent = stats.total_leads;
    document.getElementById('stat-web').textContent = stats.web_leads;
    document.getElementById('stat-whatsapp').textContent = stats.whatsapp_leads;
    document.getElementById('dash-subtitle').textContent =
      `${stats.total_leads} total leads · Last updated ${new Date().toLocaleTimeString()}`;

    renderLeadsTable(stats.recent_leads || []);
    document.getElementById('table-badge').textContent = `${(stats.recent_leads || []).length} recent`;

  } catch (err) {
    console.error('Dashboard load error:', err);
    if (err.message.includes('401') || err.message.includes('credentials')) {
      adminLogout();
    } else {
      showToast('Failed to load dashboard: ' + err.message, 'error');
    }
  }
}

async function loadLeadsTable() {
  if (!api.token) { showScreen('admin-login'); return; }

  document.getElementById('leads-tbody').innerHTML =
    '<tr><td colspan="6" class="table-loading">Loading all leads…</td></tr>';

  try {
    const data = await api.get('/api/leads/?limit=100');
    renderLeadsTable(data.leads || []);
    document.getElementById('table-badge').textContent = `${data.total} total`;
  } catch (err) {
    showToast('Failed to load leads: ' + err.message, 'error');
  }
}

function renderLeadsTable(leads) {
  const tbody = document.getElementById('leads-tbody');
  if (!leads || leads.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="table-loading">No leads yet.</td></tr>';
    return;
  }

  tbody.innerHTML = leads.map(lead => {
    const date = lead.created_at
      ? new Date(lead.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
      : '—';
    const channel = lead.source_channel || 'web';
    const channelClass = channel === 'whatsapp' ? 'channel-whatsapp' : 'channel-web';

    return `
      <tr>
        <td>${escapeHtml(lead.name || '—')}</td>
        <td>${escapeHtml(lead.email || '—')}</td>
        <td>${escapeHtml(lead.phone || '—')}</td>
        <td>${escapeHtml(lead.product_interest || '—')}</td>
        <td><span class="channel-badge ${channelClass}">${channel}</span></td>
        <td>${date}</td>
      </tr>
    `;
  }).join('');
}

// ════════════════════════════════════════════════════════════════
// TOAST
// ════════════════════════════════════════════════════════════════

let toastTimeout = null;

function showToast(message, type = 'info') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = `toast toast-${type} show`;

  if (toastTimeout) clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toast.classList.remove('show');
  }, 3000);
}

// ════════════════════════════════════════════════════════════════
// UTILITIES
// ════════════════════════════════════════════════════════════════

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Keyboard support for mic button
document.addEventListener('DOMContentLoaded', () => {
  const micBtn = document.getElementById('voice-mic-btn');
  if (micBtn) {
    micBtn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggleRecording();
      }
    });
  }

  // Auto-redirect if already logged in and on admin screens
  const token = sessionStorage.getItem('vocaldesk_token');
  if (token) api.token = token;
});

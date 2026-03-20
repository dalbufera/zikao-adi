/**
 * ADK-CENTER IA - Widget Chat v4 (chat + voice TTS)
 *
 * <script src="/widget/adk-widget.js"
 *   data-adk-app-id="7"
 *   data-adk-title="Assistant Patricia"
 *   data-adk-context="..."
 *   data-adk-color="#e91e63"
 *   data-adk-tts-url="https://192.168.1.17:3100"
 *   data-adk-tts-voice="nova">
 * </script>
 */
(function() {
  'use strict';

  const script = document.currentScript || document.querySelector('script[src*="adk-widget"]');
  const scriptSrc = script?.src || '';
  const autoUrl = scriptSrc.replace(/\/(widget|static)\/adk-widget\.js.*/, '');

  const CONFIG = {
    apiKey: script?.getAttribute('data-adk-key') || '',
    apiUrl: script?.getAttribute('data-adk-url') || autoUrl,
    position: script?.getAttribute('data-adk-position') || 'bottom-right',
    title: script?.getAttribute('data-adk-title') || 'Assistant IA',
    context: script?.getAttribute('data-adk-context') || 'Tu es un assistant intelligent et amical. Reponds de maniere concise et utile en francais.',
    color: script?.getAttribute('data-adk-color') || '#3b82f6',
    appId: parseInt(script?.getAttribute('data-adk-app-id') || '0') || null,
    ttsUrl: script?.getAttribute('data-adk-tts-url') || '',
    ttsVoice: script?.getAttribute('data-adk-tts-voice') || 'nova',
  };

  let isOpen = false;
  let messages = [];
  let isLoading = false;
  let ttsEnabled = !!CONFIG.ttsUrl;
  let currentAudio = null;

  const STYLES = `
    #adk-widget-btn {
      position: fixed;
      ${CONFIG.position === 'bottom-left' ? 'left: 20px' : 'right: 20px'};
      bottom: 20px;
      width: 56px; height: 56px;
      border-radius: 50%;
      background: ${CONFIG.color};
      color: white;
      border: none;
      cursor: pointer;
      box-shadow: 0 4px 16px rgba(0,0,0,0.3);
      z-index: 99999;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 24px;
      transition: transform 0.2s, box-shadow 0.2s;
    }
    #adk-widget-btn:hover {
      transform: scale(1.1);
      box-shadow: 0 6px 24px rgba(0,0,0,0.4);
    }
    #adk-widget-panel {
      position: fixed;
      ${CONFIG.position === 'bottom-left' ? 'left: 20px' : 'right: 20px'};
      bottom: 86px;
      width: 380px;
      height: 500px;
      background: #0f172a;
      border-radius: 16px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.5);
      z-index: 99998;
      display: none;
      flex-direction: column;
      overflow: hidden;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      color: #e2e8f0;
      border: 1px solid #1e293b;
    }
    #adk-widget-panel.open { display: flex; }
    #adk-header {
      background: #111827;
      padding: 14px 16px;
      display: flex;
      align-items: center;
      gap: 10px;
      border-bottom: 1px solid #1e293b;
    }
    #adk-header-title { font-weight: 700; font-size: 15px; flex: 1; }
    #adk-header-status { font-size: 11px; color: #22c55e; }
    #adk-tts-toggle {
      background: none; border: 1px solid #334155; color: #64748b;
      cursor: pointer; font-size: 16px; padding: 2px 6px; border-radius: 6px;
      transition: all 0.2s;
    }
    #adk-tts-toggle.active { color: ${CONFIG.color}; border-color: ${CONFIG.color}; }
    #adk-tts-toggle:hover { border-color: ${CONFIG.color}; }
    #adk-messages {
      flex: 1;
      overflow-y: auto;
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .adk-msg {
      max-width: 85%;
      padding: 10px 14px;
      border-radius: 12px;
      font-size: 13px;
      line-height: 1.5;
      word-wrap: break-word;
      white-space: pre-wrap;
    }
    .adk-msg.user {
      align-self: flex-end;
      background: ${CONFIG.color};
      color: white;
      border-bottom-right-radius: 4px;
    }
    .adk-msg.assistant {
      align-self: flex-start;
      background: #1e293b;
      color: #e2e8f0;
      border-bottom-left-radius: 4px;
    }
    .adk-msg.system {
      align-self: center;
      background: transparent;
      color: #64748b;
      font-size: 11px;
      text-align: center;
    }
    .adk-msg-meta {
      font-size: 10px;
      color: #64748b;
      margin-top: 4px;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .adk-speak-btn {
      background: none; border: none; color: #64748b; cursor: pointer;
      font-size: 13px; padding: 0; transition: color 0.2s;
    }
    .adk-speak-btn:hover { color: ${CONFIG.color}; }
    .adk-speak-btn.playing { color: ${CONFIG.color}; }
    #adk-input-area {
      padding: 12px;
      background: #111827;
      border-top: 1px solid #1e293b;
      display: flex;
      gap: 8px;
    }
    #adk-input {
      flex: 1;
      background: #0a0e1a;
      border: 1px solid #334155;
      border-radius: 8px;
      padding: 10px 12px;
      color: #e2e8f0;
      font-size: 13px;
      outline: none;
      resize: none;
      font-family: inherit;
      min-height: 40px;
      max-height: 100px;
    }
    #adk-input:focus { border-color: ${CONFIG.color}; }
    #adk-send {
      background: ${CONFIG.color};
      color: white;
      border: none;
      border-radius: 8px;
      padding: 0 16px;
      cursor: pointer;
      font-weight: 600;
      font-size: 14px;
    }
    #adk-send:disabled { opacity: 0.5; cursor: not-allowed; }
    .adk-loading {
      display: inline-block;
      width: 8px; height: 8px;
      border-radius: 50%;
      background: ${CONFIG.color};
      animation: adk-pulse 0.8s infinite alternate;
    }
    @keyframes adk-pulse { to { opacity: 0.3; transform: scale(0.8); } }
    #adk-close {
      background: none; border: none; color: #64748b; cursor: pointer; font-size: 18px; padding: 4px;
    }
    #adk-close:hover { color: #ef4444; }
  `;

  function createWidget() {
    const style = document.createElement('style');
    style.textContent = STYLES;
    document.head.appendChild(style);

    const btn = document.createElement('button');
    btn.id = 'adk-widget-btn';
    btn.innerHTML = '\uD83D\uDCAC';
    btn.title = CONFIG.title;
    btn.onclick = toggle;
    document.body.appendChild(btn);

    const ttsToggleHtml = CONFIG.ttsUrl
      ? `<button id="adk-tts-toggle" class="${ttsEnabled ? 'active' : ''}" title="Activer/desactiver la voix">\uD83D\uDD0A</button>`
      : '';

    const panel = document.createElement('div');
    panel.id = 'adk-widget-panel';
    panel.innerHTML = `
      <div id="adk-header">
        <span style="font-size:18px">\u2728</span>
        <span id="adk-header-title">${CONFIG.title}</span>
        <span id="adk-header-status">\u25CF Connexion...</span>
        ${ttsToggleHtml}
        <button id="adk-close">\u2715</button>
      </div>
      <div id="adk-messages">
        <div class="adk-msg system">Bonjour ! Comment puis-je vous aider ?</div>
      </div>
      <div id="adk-input-area">
        <textarea id="adk-input" placeholder="Ecrivez votre message..." rows="1"></textarea>
        <button id="adk-send">Envoyer</button>
      </div>
    `;
    document.body.appendChild(panel);

    document.getElementById('adk-close').onclick = toggle;
    document.getElementById('adk-send').onclick = sendChat;
    document.getElementById('adk-input').addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
    });

    const ttsToggle = document.getElementById('adk-tts-toggle');
    if (ttsToggle) {
      ttsToggle.onclick = () => {
        ttsEnabled = !ttsEnabled;
        ttsToggle.classList.toggle('active', ttsEnabled);
        if (!ttsEnabled && currentAudio) {
          currentAudio.pause();
          currentAudio = null;
        }
      };
    }

    checkStatus();
  }

  function toggle() {
    isOpen = !isOpen;
    document.getElementById('adk-widget-panel').classList.toggle('open', isOpen);
    if (isOpen) document.getElementById('adk-input')?.focus();
  }

  async function checkStatus() {
    try {
      const resp = await fetch(`${CONFIG.apiUrl}/api/v1/ai/status`);
      const data = await resp.json();
      const status = document.getElementById('adk-header-status');
      if (data.available) {
        status.textContent = `\u25CF ${data.channels_online} IA en ligne`;
        status.style.color = '#22c55e';
      } else {
        status.textContent = '\u25CF Hors ligne';
        status.style.color = '#ef4444';
      }
    } catch (e) {
      const status = document.getElementById('adk-header-status');
      if (status) { status.textContent = '\u25CF Deconnecte'; status.style.color = '#ef4444'; }
    }
  }

  async function speakText(text, btn) {
    if (!CONFIG.ttsUrl || !ttsEnabled) return;
    if (currentAudio) { currentAudio.pause(); currentAudio = null; }

    try {
      if (btn) btn.classList.add('playing');
      const resp = await fetch(`${CONFIG.ttsUrl}/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text, voice: CONFIG.ttsVoice, speed: 1.0 }),
      });
      if (!resp.ok) throw new Error('TTS error');
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      currentAudio = new Audio(url);
      currentAudio.onended = () => {
        if (btn) btn.classList.remove('playing');
        URL.revokeObjectURL(url);
        currentAudio = null;
      };
      currentAudio.onerror = () => {
        if (btn) btn.classList.remove('playing');
        currentAudio = null;
      };
      currentAudio.play();
    } catch (e) {
      if (btn) btn.classList.remove('playing');
      console.log('TTS error:', e.message);
    }
  }

  function addMessage(role, content, meta = '') {
    const container = document.getElementById('adk-messages');
    const div = document.createElement('div');
    div.className = `adk-msg ${role}`;
    div.textContent = content;
    if (meta || (role === 'assistant' && CONFIG.ttsUrl)) {
      const metaDiv = document.createElement('div');
      metaDiv.className = 'adk-msg-meta';
      if (meta) {
        const metaSpan = document.createElement('span');
        metaSpan.textContent = meta;
        metaDiv.appendChild(metaSpan);
      }
      if (role === 'assistant' && CONFIG.ttsUrl) {
        const speakBtn = document.createElement('button');
        speakBtn.className = 'adk-speak-btn';
        speakBtn.innerHTML = '\uD83D\uDD0A';
        speakBtn.title = 'Ecouter';
        speakBtn.onclick = () => speakText(content, speakBtn);
        metaDiv.appendChild(speakBtn);
      }
      div.appendChild(metaDiv);
    }
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
    return div;
  }

  function addLoading() {
    const container = document.getElementById('adk-messages');
    const div = document.createElement('div');
    div.className = 'adk-msg assistant';
    div.id = 'adk-loading';
    div.innerHTML = '<span class="adk-loading"></span> <span class="adk-loading" style="animation-delay:0.2s"></span> <span class="adk-loading" style="animation-delay:0.4s"></span>';
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
  }

  function removeLoading() { document.getElementById('adk-loading')?.remove(); }

  async function apiCall(endpoint, body) {
    const headers = { 'Content-Type': 'application/json' };
    if (CONFIG.apiKey) headers['X-ADK-Key'] = CONFIG.apiKey;
    const resp = await fetch(`${CONFIG.apiUrl}/api/v1/ai/${endpoint}`, {
      method: 'POST', headers, body: JSON.stringify(body),
    });
    return resp.json();
  }

  async function sendChat() {
    const input = document.getElementById('adk-input');
    const text = input.value.trim();
    if (!text || isLoading) return;

    input.value = '';
    addMessage('user', text);
    messages.push({ role: 'user', content: text });

    isLoading = true;
    document.getElementById('adk-send').disabled = true;
    addLoading();

    try {
      const body = {
        message: text,
        context: CONFIG.context,
        history: messages.slice(-10),
        web_search: 'auto',
      };
      if (CONFIG.appId) body.app_id = CONFIG.appId;

      const data = await apiCall('chat', body);
      removeLoading();

      if (data.success) {
        const meta = `${data.channel} | ${data.model}`;
        addMessage('assistant', data.response, meta);
        messages.push({ role: 'assistant', content: data.response });
        // Auto-speak if TTS enabled
        if (ttsEnabled && CONFIG.ttsUrl) {
          speakText(data.response);
        }
      } else {
        addMessage('system', `Erreur: ${data.error || data.detail || 'Probleme inconnu'}`);
      }
    } catch (e) {
      removeLoading();
      addMessage('system', `Erreur de connexion: ${e.message}`);
    }

    isLoading = false;
    document.getElementById('adk-send').disabled = false;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createWidget);
  } else {
    createWidget();
  }
})();

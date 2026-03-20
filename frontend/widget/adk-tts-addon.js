/**
 * ADK-CENTER IA - TTS Voice Addon for Widget
 * Adds text-to-speech capability to the existing ADK widget chat
 *
 * Add after adk-widget.js:
 * <script src="https://192.168.1.17:3100/widget/adk-tts-addon.js"></script>
 */
(function() {
  'use strict';

  const TTS_URL = 'https://192.168.1.17:3100/tts';
  const TTS_VOICE = 'nova'; // Feminine friendly voice for Patricia
  let ttsEnabled = true;
  let currentAudio = null;

  function waitForWidget(cb, tries) {
    if (tries <= 0) return;
    if (document.getElementById('adk-widget-panel')) return cb();
    setTimeout(() => waitForWidget(cb, tries - 1), 300);
  }

  function injectTTS() {
    // Add TTS toggle button in header
    const header = document.getElementById('adk-header');
    if (!header) return;

    const closeBtn = document.getElementById('adk-close');
    const ttsBtn = document.createElement('button');
    ttsBtn.id = 'adk-tts-toggle';
    ttsBtn.innerHTML = '\uD83D\uDD0A';
    ttsBtn.title = 'Activer/desactiver la voix';
    ttsBtn.style.cssText = 'background:none;border:1px solid #e91e63;color:#e91e63;cursor:pointer;font-size:16px;padding:2px 6px;border-radius:6px;transition:all 0.2s;';
    ttsBtn.onclick = function() {
      ttsEnabled = !ttsEnabled;
      ttsBtn.style.borderColor = ttsEnabled ? '#e91e63' : '#334155';
      ttsBtn.style.color = ttsEnabled ? '#e91e63' : '#64748b';
      if (!ttsEnabled && currentAudio) { currentAudio.pause(); currentAudio = null; }
    };
    header.insertBefore(ttsBtn, closeBtn);

    // Observe new messages
    const messagesContainer = document.getElementById('adk-messages');
    if (!messagesContainer) return;

    const observer = new MutationObserver(function(mutations) {
      mutations.forEach(function(m) {
        m.addedNodes.forEach(function(node) {
          if (node.nodeType !== 1) return;
          if (!node.classList.contains('adk-msg') || !node.classList.contains('assistant')) return;
          // Skip loading indicator
          if (node.id === 'adk-loading') return;

          // Add speak button
          var text = node.childNodes[0]?.textContent || node.textContent;
          var metaDiv = node.querySelector('.adk-msg-meta');
          if (!metaDiv) {
            metaDiv = document.createElement('div');
            metaDiv.className = 'adk-msg-meta';
            metaDiv.style.cssText = 'font-size:10px;color:#64748b;margin-top:4px;display:flex;align-items:center;gap:6px;';
            node.appendChild(metaDiv);
          }

          var speakBtn = document.createElement('button');
          speakBtn.innerHTML = '\uD83D\uDD0A';
          speakBtn.title = 'Ecouter';
          speakBtn.style.cssText = 'background:none;border:none;color:#64748b;cursor:pointer;font-size:13px;padding:0;transition:color 0.2s;';
          speakBtn.onmouseover = function() { speakBtn.style.color = '#e91e63'; };
          speakBtn.onmouseout = function() { if (!speakBtn.classList.contains('playing')) speakBtn.style.color = '#64748b'; };
          speakBtn.onclick = function() { speakText(text, speakBtn); };
          metaDiv.appendChild(speakBtn);

          // Auto-speak if enabled
          if (ttsEnabled) {
            speakText(text, speakBtn);
          }
        });
      });
    });
    observer.observe(messagesContainer, { childList: true });
  }

  function speakText(text, btn) {
    if (currentAudio) { currentAudio.pause(); currentAudio = null; }
    if (!text) return;

    if (btn) { btn.style.color = '#e91e63'; btn.classList.add('playing'); }

    fetch(TTS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text.substring(0, 4096), voice: TTS_VOICE, speed: 1.0 }),
    })
    .then(function(resp) {
      if (!resp.ok) throw new Error('TTS error');
      return resp.blob();
    })
    .then(function(blob) {
      var url = URL.createObjectURL(blob);
      currentAudio = new Audio(url);
      currentAudio.onended = function() {
        if (btn) { btn.style.color = '#64748b'; btn.classList.remove('playing'); }
        URL.revokeObjectURL(url);
        currentAudio = null;
      };
      currentAudio.onerror = function() {
        if (btn) { btn.style.color = '#64748b'; btn.classList.remove('playing'); }
        currentAudio = null;
      };
      currentAudio.play();
    })
    .catch(function(e) {
      if (btn) { btn.style.color = '#64748b'; btn.classList.remove('playing'); }
      console.log('TTS addon error:', e.message);
    });
  }

  waitForWidget(injectTTS, 30);
})();

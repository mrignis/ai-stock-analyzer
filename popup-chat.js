'use strict';

// ── Chat ──────────────────────────────────────────────────────────────────────
// Split out of popup.js (no build step): shares the global scope, loaded before
// popup.js so its functions exist when the DOMContentLoaded handler wires them.
// Global state (chatHistory, chatContext, conversations, currentConvId,
// convListVisible, chatSending) is declared in popup.js.

// Shows ctx bar with ticker, or hides it when ticker is falsy
function setCtxBar(ticker) {
  document.getElementById('chat-ctx-ticker').textContent = ticker || '';
  document.getElementById('chat-ctx-bar').style.display = ticker ? 'flex' : 'none';
}

function welcomeHtml(text) {
  return '<div class="chat-welcome" id="chat-welcome"><div class="chat-welcome-icon">🤖</div>' +
    '<p id="lbl-chat-welcome">' + text + '</p></div>';
}

function saveConversations() {
  save({ conversations: conversations, currentConvId: currentConvId });
}

function saveCurrentConv() {
  if (!currentConvId) return;
  var idx = conversations.findIndex(function(c) { return c.id === currentConvId; });
  if (idx >= 0) {
    conversations[idx].messages = chatHistory;
    conversations[idx].context = chatContext;
  }
  saveConversations();
}

function newChat() {
  // Save current conv if has messages
  if (chatHistory.length > 0) saveCurrentConv();

  // Create new conversation
  var id = Date.now();
  var conv = { id: id, title: lang === 'ua' ? 'Новий діалог' : 'New chat', messages: [], context: null, date: id };
  conversations.unshift(conv);
  currentConvId = id;
  chatHistory = [];
  chatContext = null;

  // Reset UI
  document.getElementById('chat-conv-title').textContent = conv.title;
  setCtxBar(null);
  document.getElementById('chat-messages').innerHTML =
    welcomeHtml(lang === 'ua' ? 'Привіт! Запитай мене про будь-яку акцію або ринок.' : 'Hi! Ask me about any stock or market.');

  // Hide conv list if visible
  if (convListVisible) toggleConvList();
  document.getElementById('chat-input').focus();
  saveConversations();
}

function toggleConvList() {
  convListVisible = !convListVisible;
  var listEl = document.getElementById('conv-list');
  var msgsEl = document.getElementById('chat-messages');
  var inputRow = document.querySelector('.chat-input-row');
  var ctxBar = document.getElementById('chat-ctx-bar');

  if (convListVisible) {
    listEl.classList.add('active');
    msgsEl.style.display = 'none';
    inputRow.style.display = 'none';
    ctxBar.style.display = 'none';
    renderConvList();
  } else {
    listEl.classList.remove('active');
    msgsEl.style.display = 'flex';
    inputRow.style.display = 'flex';
    if (chatContext) ctxBar.style.display = 'flex';
  }
}

function renderConvList() {
  var el = document.getElementById('conv-list');
  if (!conversations.length) {
    el.innerHTML = '<div class="conv-empty">' + (lang === 'ua' ? 'Немає збережених діалогів' : 'No saved conversations') + '</div>';
    return;
  }
  var html = '';
  conversations.forEach(function(c) {
    var ago = timeSince(c.date);
    var isCurrent = c.id === currentConvId;
    html += '<div class="conv-item' + (isCurrent ? ' current' : '') + '" data-id="' + c.id + '">' +
      '<div class="conv-info"><div class="conv-title">' + escHtml(c.title) + '</div><div class="conv-date">' + ago + ' · ' + c.messages.length + (lang === 'ua' ? ' повід.' : ' msg') + '</div></div>' +
      '<button class="conv-del" data-id="' + c.id + '">🗑</button>' +
    '</div>';
  });
  el.innerHTML = html;

  el.querySelectorAll('.conv-item').forEach(function(item) {
    item.addEventListener('click', function(e) {
      if (e.target.classList.contains('conv-del')) return;
      loadConversation(parseInt(this.getAttribute('data-id')));
    });
  });
  el.querySelectorAll('.conv-del').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      deleteConversation(parseInt(this.getAttribute('data-id')));
    });
  });
}

function loadConversation(id) {
  if (chatHistory.length > 0) saveCurrentConv();
  var conv = conversations.find(function(c) { return c.id === id; });
  if (!conv) return;

  currentConvId = id;
  chatHistory = conv.messages || [];
  chatContext = conv.context || null;
  document.getElementById('chat-conv-title').textContent = conv.title;

  // Restore context bar
  setCtxBar(chatContext ? chatContext.split(':')[0] : null);

  // Restore messages
  document.getElementById('chat-messages').innerHTML = '';
  if (chatHistory.length === 0) {
    document.getElementById('chat-messages').innerHTML =
      welcomeHtml(lang === 'ua' ? 'Продовжуй діалог...' : 'Continue the conversation...');
  } else {
    chatHistory.forEach(function(msg) {
      appendChatMsg(msg.role === 'assistant' ? 'ai' : 'user', msg.content);
    });
  }

  saveConversations();
  if (convListVisible) toggleConvList();
}

function deleteConversation(id) {
  conversations = conversations.filter(function(c) { return c.id !== id; });
  if (currentConvId === id) {
    if (conversations.length > 0) {
      loadConversation(conversations[0].id);
      return;
    } else {
      currentConvId = null;
      chatHistory = [];
      chatContext = null;
      document.getElementById('chat-conv-title').textContent = lang === 'ua' ? 'Новий діалог' : 'New chat';
      setCtxBar(null);
    }
  }
  saveConversations();
  renderConvList();
}

function setChatContext(ticker, data) {
  var q = data._quote || {};
  var priceStr = q.c ? '$' + q.c + (q.dp != null ? ' (' + (q.dp > 0 ? '+' : '') + q.dp.toFixed(2) + '% today)' : '') : '';
  chatContext = ticker + (priceStr ? ' current price ' + priceStr : '') +
    (data._name ? ' (' + data._name + ')' : '') +
    ': sector=' + data.sector +
    (data._country ? ', country of registration=' + data._country : '') +
    ', verdict=' + data.verdict +
    ', trend=' + data.trend +
    ', risk=' + data.risk +
    (data.what ? ', company: ' + data.what : '') +
    '. Forecast: ' + data.forecast;
  setCtxBar(ticker);
  saveCurrentConv();
}

function clearChatContext() {
  chatContext = null;
  setCtxBar(null);
  saveCurrentConv();
}

function timeSince(ts) { return timeAgo(ts, false); }

function sendChat() {
  if (chatSending) return; // block concurrent sends
  var input = document.getElementById('chat-input');
  var msg = input.value.trim();
  if (!msg) return;
  chatSending = true;
  var sendBtn = document.getElementById('chat-send-btn');
  sendBtn.disabled = true;
  input.value = '';
  input.focus();

  // Auto-create conversation on first message
  if (!currentConvId) {
    var id = Date.now();
    var title = msg.slice(0, 35) + (msg.length > 35 ? '…' : '');
    var conv = { id: id, title: title, messages: [], context: chatContext, date: id };
    conversations.unshift(conv);
    currentConvId = id;
    document.getElementById('chat-conv-title').textContent = title;
    saveConversations();
  } else if (chatHistory.length === 0) {
    // Update title from first message
    var idx = conversations.findIndex(function(c) { return c.id === currentConvId; });
    if (idx >= 0) {
      conversations[idx].title = msg.slice(0, 35) + (msg.length > 35 ? '…' : '');
      document.getElementById('chat-conv-title').textContent = conversations[idx].title;
    }
  }

  appendChatMsg('user', msg);
  chatHistory.push({ role: 'user', content: msg });

  var typingEl = appendChatMsg('ai', lang === 'ua' ? 'Думаю...' : 'Thinking...', true);

  fetch(WORKER_URL + '/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: chatHistory, context: chatContext, lang: lang, currency: currency, fxRate: fxRate }),
  })
    .then(function(r) { return r.text(); })
    .then(function(txt) {
      try { return JSON.parse(txt); }
      catch (_) {
        throw new Error(lang === 'ua'
          ? 'Сервер тимчасово недоступний. Спробуй ще раз за хвилину.'
          : 'Server temporarily unavailable. Try again in a minute.');
      }
    })
    .then(function(data) {
      typingEl.remove();
      if (data.error) {
        var errMsg = data.error;
        var retryMatch = errMsg.match(/retry in ([\d.]+)s/i);
        if (errMsg.toLowerCase().includes('quota') || errMsg.toLowerCase().includes('exhausted')) {
          var sec = retryMatch ? Math.ceil(parseFloat(retryMatch[1])) : 60;
          errMsg = lang === 'ua'
            ? '⏳ Перевищено ліміт запитів. Спробуй через ' + sec + ' сек.'
            : '⏳ Rate limit reached. Try again in ' + sec + ' sec.';
        }
        appendChatMsg('ai', errMsg);
      } else {
        var reply = data.reply || (lang === 'ua' ? 'Порожня відповідь.' : 'Empty response.');
        appendChatMsg('ai', reply);
        chatHistory.push({ role: 'assistant', content: reply });
        if (chatHistory.length > 40) chatHistory = chatHistory.slice(-40);
        saveCurrentConv();
      }
    })
    .catch(function(e) {
      typingEl.remove();
      if (!(e && e.name === 'AbortError')) {
        appendChatMsg('ai', '⚠ ' + (e && e.message ? e.message : (lang === 'ua' ? 'Помилка зв\'язку.' : 'Connection error.')));
      }
    })
    .finally(function() {
      chatSending = false;
      document.getElementById('chat-send-btn').disabled = false;
    });
}

function renderChatText(text) {
  // Escape HTML first to prevent XSS, then strip markdown, then render line breaks
  var safe = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  var clean = safe
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/^#+\s*/gm, '')     // only strip # at start of a line, not mid-sentence
    .replace(/`(.+?)`/g, '$1')
    .replace(/^\*\s+/gm, '• ');  // leftover "* " list markers → clean bullet
  var parts = clean.split(/\n{2,}/);
  return parts.map(function(p) {
    var t = p.replace(/\n/g, '<br>').trim();
    return t ? '<p style="margin:0 0 6px">' + t + '</p>' : '';
  }).join('');
}

function appendChatMsg(role, content, isTyping) {
  var container = document.getElementById('chat-messages');
  var welcome = document.getElementById('chat-welcome');
  if (welcome) welcome.style.display = 'none';

  if (role === 'ai' && !isTyping) {
    var wrap = document.createElement('div');
    wrap.className = 'chat-msg-wrap';
    var el = document.createElement('div');
    el.className = 'chat-msg ai';
    el.innerHTML = renderChatText(content);
    var copyBtn = document.createElement('button');
    copyBtn.className = 'chat-copy-btn';
    copyBtn.textContent = '⎘';
    copyBtn.title = 'Copy';
    copyBtn.addEventListener('click', function() {
      navigator.clipboard.writeText(content).then(function() {
        copyBtn.textContent = '✓';
        setTimeout(function() { copyBtn.textContent = '⎘'; }, 1500);
      });
    });
    wrap.appendChild(el);
    wrap.appendChild(copyBtn);
    container.appendChild(wrap);
    container.scrollTop = container.scrollHeight;
    return el;
  }

  var el = document.createElement('div');
  el.className = 'chat-msg ' + role + (isTyping ? ' typing' : '');
  if (isTyping) {
    el.textContent = content;
  } else {
    el.innerHTML = renderChatText(content);
  }
  container.appendChild(el);
  container.scrollTop = container.scrollHeight;
  return el;
}

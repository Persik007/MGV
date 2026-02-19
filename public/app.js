// MGV Messenger — Client App
(function() {
'use strict';

// ── State ──
var state = {
  ws: null,
  myName: '',
  myPass: '',
  myRole: 'user',
  currentRoom: null,
  channels: [],
  online: [],
  unread: {},
  pendingFile: null,
  typingTimeout: null,
  typingTimers: {}
};

// WebRTC state
var rtc = {
  pc: null,
  localStream: null,
  isMuted: false,
  timerInt: null,
  timerStart: null,
  incOffer: null,
  incFrom: null,
  iceQueue: [],
  remoteDescSet: false
};

var TURN_API = 'https://mgv.metered.live/api/v1/turn/credentials?apiKey=c26a2ef76f54f5c0d4e8f66a0d11cb69aa2b';
var cachedIce = null;

var COLORS = ['#3b82f6','#8b5cf6','#ec4899','#f59e0b','#10b981','#ef4444','#06b6d4','#84cc16'];
function gc(n) { var h=0; for(var i=0;i<n.length;i++) h=(h*31+n.charCodeAt(i))%COLORS.length; return COLORS[h]; }
function ini(n) { return (n||'?')[0].toUpperCase(); }
function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function fmt(t) { return new Date(t).toLocaleTimeString('ru',{hour:'2-digit',minute:'2-digit'}); }
function fmtSize(b) {
  if(b<1024) return b+'B';
  if(b<1048576) return (b/1024).toFixed(1)+'KB';
  return (b/1048576).toFixed(1)+'MB';
}
function isImage(mime) { return mime && mime.startsWith('image/'); }

// ── DOM helpers ──
function $(id) { return document.getElementById(id); }
function $c(sel) { return document.querySelector(sel); }

// ── Auth ──
function showErr(msg) { $('login-err').textContent = msg; }

function doLogin() {
  var n = $('l-name').value.trim();
  var p = $('l-pass').value;
  if (!n) { showErr('Введите имя'); return; }
  if (!p) { showErr('Введите пароль'); return; }
  showErr('');
  state.myName = n;
  state.myPass = p;
  connectWS();
}
function doLogout() {
  localStorage.removeItem('mgv_n');
  localStorage.removeItem('mgv_p');
  location.reload();
}

// ── WebSocket ──
function connectWS() {
  var proto = location.protocol === 'https:' ? 'wss' : 'ws';
  state.ws = new WebSocket(proto + '://' + location.host);
  state.ws.onopen = function() {
    wsSend({ type: 'auth', name: state.myName, pass: state.myPass });
  };
  state.ws.onclose = function() {
    setConnStatus(false);
    setTimeout(connectWS, 2000);
  };
  state.ws.onmessage = function(e) {
    try { handleMsg(JSON.parse(e.data)); } catch(err) { console.error(err); }
  };
}

function wsSend(obj) {
  if (state.ws && state.ws.readyState === 1) state.ws.send(JSON.stringify(obj));
}

function setConnStatus(on) {
  var dot = $('conn-dot');
  if (dot) dot.className = 'online-dot' + (on ? '' : ' offline');
}

// ── Message handler ──
function handleMsg(msg) {
  switch (msg.type) {
    case 'auth-ok':
      onAuthOk(msg); break;
    case 'auth-fail':
      showErr(msg.reason || 'Ошибка'); $('login-screen').style.display = 'flex'; break;
    case 'kicked':
      alert(msg.reason); doLogout(); break;
    case 'channels':
      state.channels = msg.channels; renderSidebar(); break;
    case 'online':
      state.online = msg.users; renderOnline(); break;
    case 'history':
      renderHistory(msg.room, msg.messages); break;
    case 'channel-msg':
      onNewMsg(msg.room, msg.message); break;
    case 'msg-deleted':
      onMsgDeleted(msg.room, msg.msgId); break;
    case 'typing':
      onTyping(msg.room, msg.from); break;
    case 'call-offer': rtcHandleOffer(msg); break;
    case 'call-answer': rtcHandleAnswer(msg); break;
    case 'ice': rtcHandleIce(msg); break;
    case 'call-end': rtcRemoteEnd(); break;
    case 'call-decline': rtcCallDeclined(); break;
  }
}

function onAuthOk(msg) {
  state.myName = msg.name;
  state.myRole = msg.role;
  localStorage.setItem('mgv_n', state.myName);
  localStorage.setItem('mgv_p', state.myPass);
  $('login-screen').style.display = 'none';
  $('app').classList.add('visible');
  $('topbar-user').textContent = state.myName;
  setConnStatus(true);
  if (state.myRole === 'admin') {
    var adminLink = $('admin-link');
    if (adminLink) adminLink.style.display = 'flex';
  }
}

// ── Sidebar ──
function renderSidebar() {
  var list = $('channel-list');
  if (!list) return;
  list.innerHTML = '';
  state.channels.forEach(function(ch) {
    var item = document.createElement('div');
    item.className = 'sidebar-item' + (state.currentRoom === ch.id ? ' active' : '');
    item.dataset.room = ch.id;
    var badge = state.unread[ch.id] ? '<span class="si-badge">' + state.unread[ch.id] + '</span>' : '';
    item.innerHTML = '<span class="si-icon">#</span><span class="si-name">' + esc(ch.name) + '</span>' + badge;
    item.addEventListener('click', function() { openRoom(ch.id, 'channel'); });
    list.appendChild(item);
  });
}

function renderOnline() {
  var list = $('online-list');
  if (!list) return;
  list.innerHTML = '';
  state.online.forEach(function(name) {
    if (name === state.myName) return;
    var item = document.createElement('div');
    item.className = 'online-user';
    var col = gc(name);
    var dmRoom = 'dm:' + [state.myName, name].sort().join(':');
    var badge = state.unread[dmRoom] ? '<span class="si-badge" style="margin-left:auto">' + state.unread[dmRoom] + '</span>' : '<span class="ou-dot"></span>';
    item.innerHTML = '<div class="ou-avatar" style="background:' + col + '22;color:' + col + '">' + ini(name) + '</div>'
      + '<span class="ou-name">' + esc(name) + '</span>' + badge;
    item.addEventListener('click', function() {
      var room = 'dm:' + [state.myName, name].sort().join(':');
      openRoom(room, 'dm', name);
    });
    list.appendChild(item);
  });
}

// ── Open room ──
function openRoom(room, type, peerName) {
  state.currentRoom = room;
  // clear unread
  state.unread[room] = 0;

  // update sidebar active
  document.querySelectorAll('.sidebar-item, .online-user').forEach(function(el) {
    el.classList.remove('active');
  });
  var activeItem = document.querySelector('.sidebar-item[data-room="' + room + '"]');
  if (activeItem) activeItem.classList.add('active');

  // show chat area
  $('no-chat').style.display = 'none';
  $('chat-view').style.display = 'flex';

  // set header
  if (type === 'channel') {
    var ch = state.channels.find(function(c) { return c.id === room; });
    $('chat-name').textContent = '#' + (ch ? ch.name : room);
    $('chat-desc').textContent = ch && ch.description ? ch.description : '';
    $('call-btn').style.display = 'none';
  } else {
    $('chat-name').textContent = peerName;
    $('chat-desc').textContent = 'Личное сообщение';
    $('call-btn').style.display = 'flex';
    $('call-btn').dataset.peer = peerName;
  }

  $('messages').innerHTML = '';
  wsSend({ type: 'get-history', room: room });
  $('msg-input').focus();

  renderSidebar();
  renderOnline();
}

// ── History ──
function renderHistory(room, messages) {
  if (room !== state.currentRoom) return;
  var cont = $('messages');
  cont.innerHTML = '';
  if (!messages || !messages.length) {
    addSysMsg('Начало чата');
    return;
  }
  messages.forEach(function(m) { appendMsg(m); });
  cont.scrollTop = cont.scrollHeight;
}

// ── New message ──
function onNewMsg(room, message) {
  if (room === state.currentRoom) {
    appendMsg(message);
    var cont = $('messages');
    cont.scrollTop = cont.scrollHeight;
  } else {
    state.unread[room] = (state.unread[room] || 0) + 1;
    renderSidebar();
    renderOnline();
    // desktop notification
    if (Notification && Notification.permission === 'granted') {
      new Notification('MGV: ' + message.from, { body: message.text || '📎 Файл', icon: '/favicon.ico' });
    }
  }
}

function onMsgDeleted(room, msgId) {
  var el = document.querySelector('[data-msgid="' + msgId + '"]');
  if (el) el.remove();
}

function onTyping(room, from) {
  if (room !== state.currentRoom || from === state.myName) return;
  var ti = $('typing-indicator');
  if (ti) { ti.textContent = from + ' печатает...'; }
  clearTimeout(state.typingTimers[from]);
  state.typingTimers[from] = setTimeout(function() {
    if (ti) ti.textContent = '';
  }, 2000);
}

// ── Append message ──
function appendMsg(m) {
  var cont = $('messages');
  var isOwn = m.from === state.myName;
  var row = document.createElement('div');
  row.className = 'msg-row ' + (isOwn ? 'own' : 'other');
  row.dataset.msgid = m.id;

  var col = gc(m.from);
  var avatar = '<div class="msg-avatar" style="background:' + col + '22;color:' + col + '">' + ini(m.from) + '</div>';
  var delBtn = '<button class="msg-del" onclick="MGV.deleteMsg(\'' + m.id + '\')" title="Удалить">✕</button>';

  var body = '';
  if (!isOwn) body += '<div class="msg-meta"><span class="msg-author">' + esc(m.from) + '</span></div>';

  if (m.file) {
    var f = m.file;
    if (isImage(f.mime)) {
      body += '<div class="msg-bubble">' + delBtn + '<img class="msg-img" src="' + esc(f.url) + '" onclick="MGV.openImage(\'' + esc(f.url) + '\')" loading="lazy"></div>';
    } else {
      body += '<div class="msg-bubble">' + delBtn + '<a class="msg-file" href="' + esc(f.url) + '" target="_blank" download>'
        + '<span class="msg-file-icon">' + fileIcon(f.mime) + '</span>'
        + '<div class="msg-file-info"><div class="msg-file-name">' + esc(f.name) + '</div>'
        + '<div class="msg-file-size">' + fmtSize(f.size) + '</div></div></a>';
      if (m.text) body += '<div>' + esc(m.text) + '</div>';
      body += '</div>';
    }
  } else {
    body += '<div class="msg-bubble">' + delBtn + esc(m.text).replace(/\n/g,'<br>') + '</div>';
  }

  body += '<div class="msg-time">' + fmt(m.time) + '</div>';

  row.innerHTML = (isOwn ? '' : avatar)
    + '<div class="msg-body">' + body + '</div>'
    + (isOwn ? avatar : '');

  cont.appendChild(row);
}

function addSysMsg(text) {
  var cont = $('messages');
  var row = document.createElement('div');
  row.className = 'msg-row sys';
  row.innerHTML = '<div class="msg-bubble">' + esc(text) + '</div>';
  cont.appendChild(row);
}

function fileIcon(mime) {
  if (!mime) return '📄';
  if (mime.startsWith('image/')) return '🖼️';
  if (mime.startsWith('video/')) return '🎬';
  if (mime.startsWith('audio/')) return '🎵';
  if (mime.includes('pdf')) return '📕';
  if (mime.includes('zip') || mime.includes('rar')) return '🗜️';
  return '📄';
}

// ── Send message ──
function sendMsg() {
  var input = $('msg-input');
  var text = input.value.trim();

  if (!state.currentRoom) return;

  if (state.pendingFile) {
    // send with file
    var fileData = state.pendingFile;
    var msgType = state.currentRoom.startsWith('dm:') ? 'dm' : 'channel-msg';
    var payload = { type: msgType, file: fileData, text: text };
    if (msgType === 'dm') {
      payload.to = state.pendingFile._peer || getPeerFromRoom(state.currentRoom);
    } else {
      payload.room = state.currentRoom;
    }
    if (msgType === 'channel-msg') payload.room = state.currentRoom;
    wsSend(payload);
    clearPendingFile();
    input.value = '';
    return;
  }

  if (!text) return;
  input.value = '';

  if (state.currentRoom.startsWith('dm:')) {
    var peer = getPeerFromRoom(state.currentRoom);
    wsSend({ type: 'dm', to: peer, text: text });
  } else {
    wsSend({ type: 'channel-msg', room: state.currentRoom, text: text });
  }
}

function getPeerFromRoom(room) {
  // room = "dm:alice:bob"
  var parts = room.split(':');
  return parts[1] === state.myName ? parts[2] : parts[1];
}

function onTypingInput() {
  if (!state.currentRoom) return;
  clearTimeout(state.typingTimeout);
  state.typingTimeout = setTimeout(function() {
    wsSend({ type: 'typing', room: state.currentRoom });
  }, 300);
}

// ── File upload ──
function handleFileSelect(e) {
  var file = e.target.files[0];
  if (!file) return;
  uploadFile(file);
  e.target.value = '';
}

function uploadFile(file) {
  if (file.size > 50 * 1024 * 1024) { alert('Файл слишком большой (макс 50MB)'); return; }

  var preview = $('upload-preview');
  var prevName = $('upload-preview-name');
  prevName.textContent = file.name + ' (' + fmtSize(file.size) + ')';
  preview.style.display = 'flex';

  var formData = new FormData();
  formData.append('file', file);

  fetch('/upload?user=' + encodeURIComponent(state.myName), {
    method: 'POST',
    body: formData
  }).then(function(r) { return r.json(); })
  .then(function(data) {
    if (data.error) { alert('Ошибка загрузки: ' + data.error); clearPendingFile(); return; }
    state.pendingFile = data;
  })
  .catch(function(err) { alert('Ошибка загрузки'); clearPendingFile(); console.error(err); });
}

function clearPendingFile() {
  state.pendingFile = null;
  var preview = $('upload-preview');
  if (preview) preview.style.display = 'none';
}

// ── Delete message ──
function deleteMsg(msgId) {
  if (!confirm('Удалить сообщение?')) return;
  wsSend({ type: 'delete-msg', room: state.currentRoom, msgId: msgId });
}

// ── Image lightbox ──
function openImage(url) {
  var lb = $('lightbox');
  lb.querySelector('img').src = url;
  lb.classList.add('active');
}

// ── Create channel modal ──
function openCreateChannel() {
  if (state.myRole !== 'admin') return;
  $('create-channel-modal').classList.add('active');
}
function closeCreateChannel() {
  $('create-channel-modal').classList.remove('active');
}
function submitCreateChannel() {
  var name = $('new-ch-name').value.trim();
  var desc = $('new-ch-desc').value.trim();
  if (!name) return;
  wsSend({ type: 'create-channel', name: name, description: desc, channelType: 'public' });
  closeCreateChannel();
  $('new-ch-name').value = '';
  $('new-ch-desc').value = '';
}

// ── WebRTC ──
async function getIce() {
  if (cachedIce) return cachedIce;
  try {
    var r = await fetch(TURN_API);
    cachedIce = await r.json();
    return cachedIce;
  } catch(e) {
    return [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }];
  }
}

async function makePc(remoteName) {
  if (rtc.pc) { rtc.pc.close(); rtc.pc = null; }
  rtc.remoteDescSet = false; rtc.iceQueue = [];
  var iceServers = await getIce();
  rtc.pc = new RTCPeerConnection({ iceServers: iceServers });
  rtc.localStream.getTracks().forEach(function(t) { rtc.pc.addTrack(t, rtc.localStream); });
  rtc.pc.onicecandidate = function(e) {
    if (e.candidate) wsSend({ type: 'ice', to: remoteName, candidate: e.candidate });
  };
  rtc.pc.ontrack = function(e) {
    $('remote-audio').srcObject = e.streams[0];
  };
  rtc.pc.onconnectionstatechange = function() {
    console.log('RTC:', rtc.pc && rtc.pc.connectionState);
    if (rtc.pc && rtc.pc.connectionState === 'connected') {
      $('call-status').textContent = 'СОЕДИНЕНО';
      if (!rtc.timerInt) startCallTimer();
    }
    if (rtc.pc && (rtc.pc.connectionState === 'failed' || rtc.pc.connectionState === 'disconnected')) {
      addSysMsg('Связь потеряна');
      rtcCleanup();
    }
  };
}

async function flushIceQueue() {
  while (rtc.iceQueue.length) {
    try { await rtc.pc.addIceCandidate(new RTCIceCandidate(rtc.iceQueue.shift())); } catch(e) {}
  }
}

async function startCall() {
  var peer = $('call-btn').dataset.peer;
  if (!peer) return;
  $('call-peer-name').textContent = peer;
  $('call-avatar').textContent = ini(peer);
  $('call-avatar').style.background = gc(peer) + '22';
  $('call-avatar').style.color = gc(peer);
  $('call-status').textContent = 'ПОДГОТОВКА...';
  $('call-overlay').classList.add('active');

  try {
    rtc.localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch(e) {
    alert('Нет доступа к микрофону: ' + e.message);
    rtcCleanup(); return;
  }

  await makePc(peer);
  var offer = await rtc.pc.createOffer({ offerToReceiveAudio: true });
  await rtc.pc.setLocalDescription(offer);
  wsSend({ type: 'call-offer', to: peer, offer: rtc.pc.localDescription, fromName: state.myName });
  $('call-status').textContent = 'ЖДЁМ ОТВЕТА...';
}

function rtcHandleOffer(msg) {
  rtc.incOffer = msg.offer;
  rtc.incFrom = msg.fromName;
  $('inc-name').textContent = msg.fromName;
  $('incoming-call').classList.add('active');
  try {
    var ctx = new AudioContext(), osc = ctx.createOscillator(), g = ctx.createGain();
    osc.frequency.value = 480; g.gain.value = 0.07;
    osc.connect(g); g.connect(ctx.destination);
    osc.start(); setTimeout(function() { osc.stop(); ctx.close(); }, 800);
  } catch(e) {}
}

async function answerCall() {
  $('incoming-call').classList.remove('active');
  try {
    rtc.localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch(e) { alert('Нет доступа к микрофону: ' + e.message); return; }

  await makePc(rtc.incFrom);
  await rtc.pc.setRemoteDescription(new RTCSessionDescription(rtc.incOffer));
  rtc.remoteDescSet = true;
  await flushIceQueue();
  var answer = await rtc.pc.createAnswer();
  await rtc.pc.setLocalDescription(answer);
  wsSend({ type: 'call-answer', to: rtc.incFrom, answer: rtc.pc.localDescription });

  $('call-peer-name').textContent = rtc.incFrom;
  $('call-avatar').textContent = ini(rtc.incFrom);
  $('call-avatar').style.background = gc(rtc.incFrom) + '22';
  $('call-avatar').style.color = gc(rtc.incFrom);
  $('call-status').textContent = 'СОЕДИНЯЕМСЯ...';
  $('call-overlay').classList.add('active');
}

function declineCall() {
  $('incoming-call').classList.remove('active');
  wsSend({ type: 'call-decline', to: rtc.incFrom });
  rtc.incOffer = null; rtc.incFrom = null;
}

async function rtcHandleAnswer(msg) {
  if (!rtc.pc) return;
  await rtc.pc.setRemoteDescription(new RTCSessionDescription(msg.answer));
  rtc.remoteDescSet = true;
  await flushIceQueue();
}

async function rtcHandleIce(msg) {
  if (!rtc.pc) return;
  if (rtc.remoteDescSet) {
    try { await rtc.pc.addIceCandidate(new RTCIceCandidate(msg.candidate)); } catch(e) {}
  } else {
    rtc.iceQueue.push(msg.candidate);
  }
}

function endCall() {
  var peer = $('call-btn').dataset.peer || rtc.incFrom;
  if (peer) wsSend({ type: 'call-end', to: peer });
  rtcCleanup();
}

function rtcRemoteEnd() {
  addSysMsg('Звонок завершён');
  rtcCleanup();
}

function rtcCallDeclined() {
  $('call-status').textContent = 'ОТКЛОНЕНО';
  setTimeout(rtcCleanup, 1500);
}

function rtcCleanup() {
  if (rtc.pc) { rtc.pc.close(); rtc.pc = null; }
  if (rtc.localStream) { rtc.localStream.getTracks().forEach(function(t) { t.stop(); }); rtc.localStream = null; }
  $('call-overlay').classList.remove('active');
  $('remote-audio').srcObject = null;
  if (rtc.timerInt) { clearInterval(rtc.timerInt); rtc.timerInt = null; }
  $('call-timer').textContent = '';
  rtc.remoteDescSet = false; rtc.iceQueue = [];
}

function toggleMute() {
  if (!rtc.localStream) return;
  rtc.isMuted = !rtc.isMuted;
  rtc.localStream.getAudioTracks().forEach(function(t) { t.enabled = !rtc.isMuted; });
  var btn = $('mute-btn');
  btn.textContent = rtc.isMuted ? '🔇' : '🎤';
  btn.classList.toggle('muted', rtc.isMuted);
}

function startCallTimer() {
  rtc.timerStart = Date.now();
  rtc.timerInt = setInterval(function() {
    var s = Math.floor((Date.now() - rtc.timerStart) / 1000);
    var m = String(Math.floor(s / 60)).padStart(2,'0');
    var sec = String(s % 60).padStart(2,'0');
    $('call-timer').textContent = m + ':' + sec;
  }, 1000);
}

// ── Init ──
function init() {
  // Login form events
  $('l-name').addEventListener('keydown', function(e) { if(e.key==='Enter') $('l-pass').focus(); });
  $('l-pass').addEventListener('keydown', function(e) { if(e.key==='Enter') doLogin(); });
  $('login-btn').addEventListener('click', doLogin);

  // Message input
  $('msg-input').addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMsg(); }
  });
  $('msg-input').addEventListener('input', onTypingInput);
  $('send-btn').addEventListener('click', sendMsg);

  // File upload
  $('file-input').addEventListener('change', handleFileSelect);
  $('upload-cancel-btn').addEventListener('click', clearPendingFile);

  // Drag and drop
  var chatArea = $('chat-view');
  if (chatArea) {
    chatArea.addEventListener('dragover', function(e) { e.preventDefault(); });
    chatArea.addEventListener('drop', function(e) {
      e.preventDefault();
      var file = e.dataTransfer.files[0];
      if (file) uploadFile(file);
    });
  }

  // Lightbox
  $('lightbox').addEventListener('click', function() { this.classList.remove('active'); });

  // Call
  $('call-btn').addEventListener('click', startCall);
  $('call-btn').style.display = 'none';

  // Notifications
  if (Notification && Notification.permission !== 'granted') {
    Notification.requestPermission();
  }

  // Admin link visibility
  var adminLink = $('admin-link');
  if (adminLink) adminLink.style.display = 'none';

  // Auto-login
  var n = localStorage.getItem('mgv_n');
  var p = localStorage.getItem('mgv_p');
  if (n && p) {
    state.myName = n; state.myPass = p;
    connectWS();
  }
}

document.addEventListener('DOMContentLoaded', init);

// ── Public API ──
window.MGV = {
  doLogin, doLogout,
  sendMsg, deleteMsg, openImage,
  startCall, endCall, answerCall, declineCall, toggleMute,
  openCreateChannel, closeCreateChannel, submitCreateChannel,
  clearPendingFile,
  openRoom,
  attachFile: function() { $('file-input').click(); }
};

})();

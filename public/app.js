// MGV Messenger — Client App v2
(function() {
    'use strict';

    var state = {
        ws: null,
        myName: '',
        myPass: '',
        myRole: 'user',
        currentRoom: null,
        currentRoomType: null,
        currentPeer: null,
        channels: [],
        online: [],
        unread: {},
        pendingFile: null,
        typingTimeout: null,
        typingTimers: {}
    };

    var rtc = {
        pc: null,
        localStream: null,
        isMuted: false,
        isVideoOff: false,
        withVideo: false,
        timerInt: null,
        timerStart: null,
        incOffer: null,
        incFrom: null,
        incWithVideo: false,
        iceQueue: [],
        remoteDescSet: false
    };

    var voiceRec = {
        mediaRecorder: null,
        stream: null,
        chunks: [],
        timerInt: null,
        seconds: 0,
        actx: null,
        analyser: null,
        animFrame: null,
        peaks: []
    };

    var circleRec = {
        mediaRecorder: null,
        stream: null,
        chunks: [],
        timerInt: null,
        seconds: 0
    };

    var TURN_API = 'https://mgv.metered.live/api/v1/turn/credentials?apiKey=c26a2ef76f54f5c0d4e8f66a0d11cb69aa2b';
    var cachedIce = null;
    var currentAudio = null;

    var COLORS = ['#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#ef4444', '#06b6d4', '#84cc16'];

    function gc(n) { var h = 0; for (var i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) % COLORS.length; return COLORS[h]; }

    function ini(n) { return (n || '?')[0].toUpperCase(); }

    function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

    function fmt(t) { return new Date(t).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' }); }

    function fmtDur(s) { s = Math.max(0, Math.round(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }

    function fmtSize(b) { if (!b) return '0B'; if (b < 1024) return b + 'B'; if (b < 1048576) return (b / 1024).toFixed(1) + 'KB'; return (b / 1048576).toFixed(1) + 'MB'; }

    function isImage(m) { return m && /^image\//.test(m); }

    function $(id) { return document.getElementById(id); }

    // AUTH
    function showErr(msg) { $('login-err').textContent = msg; }

    function doLogin() {
        var n = $('l-name').value.trim(),
            p = $('l-pass').value;
        if (!n) { showErr('Введите имя'); return; }
        if (!p) { showErr('Введите пароль'); return; }
        showErr('');
        state.myName = n;
        state.myPass = p;
        connectWS();
    }

    function doLogout() { localStorage.removeItem('mgv_n');
        localStorage.removeItem('mgv_p');
        location.reload(); }

    // WS
    function connectWS() {
        var proto = location.protocol === 'https:' ? 'wss' : 'ws';
        state.ws = new WebSocket(proto + '://' + location.host);
        state.ws.onopen = function() { wsSend({ type: 'auth', name: state.myName, pass: state.myPass }); };
        state.ws.onclose = function() { setConn(false);
            setTimeout(connectWS, 2000); };
        state.ws.onmessage = function(e) { try { handleMsg(JSON.parse(e.data)); } catch (err) { console.error(err); } };
    }

    function wsSend(o) { if (state.ws && state.ws.readyState === 1) state.ws.send(JSON.stringify(o)); }

    function setConn(on) { var d = $('conn-dot'); if (d) d.style.background = on ? 'var(--green)' : 'var(--red)'; }

    // HANDLE
    function handleMsg(msg) {
        switch (msg.type) {
            case 'auth-ok':
                onAuthOk(msg);
                break;
            case 'auth-fail':
                showErr(msg.reason || 'Ошибка');
                $('login-screen').style.display = 'flex';
                break;
            case 'kicked':
                alert(msg.reason);
                doLogout();
                break;
            case 'channels':
                state.channels = msg.channels;
                renderSidebar();
                break;
            case 'online':
                state.online = msg.users;
                renderOnline();
                break;
            case 'history':
                renderHistory(msg.room, msg.messages);
                break;
            case 'channel-msg':
                onNewMsg(msg.room, msg.message);
                break;
            case 'msg-deleted':
                onMsgDeleted(msg.room, msg.msgId);
                break;
            case 'typing':
                onTyping(msg.room, msg.from);
                break;
            case 'call-offer':
                rtcHandleOffer(msg);
                break;
            case 'call-answer':
                rtcHandleAnswer(msg);
                break;
            case 'ice':
                rtcHandleIce(msg);
                break;
            case 'call-end':
                rtcRemoteEnd();
                break;
            case 'call-decline':
                rtcCallDeclined();
                break;
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
        setConn(true);
        if (state.myRole === 'admin') { var a = $('admin-link'); if (a) a.style.display = 'flex'; }
    }

    // SIDEBAR
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
            item.addEventListener('click', function() { openRoom(ch.id, 'channel', null); });
            list.appendChild(item);
        });
    }

    function renderOnline() {
        var list = $('online-list');
        if (!list) return;
        list.innerHTML = '';
        state.online.forEach(function(name) {
            if (name === state.myName) return;
            var col = gc(name),
                dmRoom = 'dm:' + [state.myName, name].sort().join(':');
            var badge = state.unread[dmRoom] ? '<span class="si-badge" style="margin-left:auto">' + state.unread[dmRoom] + '</span>' : '<span class="ou-dot"></span>';
            var item = document.createElement('div');
            item.className = 'online-user';
            item.innerHTML = '<div class="ou-avatar" style="background:' + col + '22;color:' + col + '">' + ini(name) + '</div><span class="ou-name">' + esc(name) + '</span>' + badge;
            item.addEventListener('click', function() { openRoom('dm:' + [state.myName, name].sort().join(':'), 'dm', name); });
            list.appendChild(item);
        });
    }

    // ROOM
    function openRoom(room, type, peer) {
        state.currentRoom = room;
        state.currentRoomType = type;
        state.currentPeer = peer;
        state.unread[room] = 0;
        document.querySelectorAll('.sidebar-item').forEach(function(el) { el.classList.remove('active'); });
        var a = document.querySelector('.sidebar-item[data-room="' + room + '"]');
        if (a) a.classList.add('active');
        $('no-chat').style.display = 'none';
        $('chat-view').style.display = 'flex';
        if (type === 'channel') {
            var ch = state.channels.find(function(c) { return c.id === room; });
            $('chat-name').textContent = '#' + (ch ? ch.name : room);
            $('chat-desc').textContent = ch && ch.description ? ch.description : '';
            $('call-buttons').style.display = 'none';
        } else {
            $('chat-name').textContent = peer;
            $('chat-desc').textContent = 'Личное сообщение';
            $('call-buttons').style.display = 'flex';
        }
        $('messages').innerHTML = '';
        wsSend({ type: 'get-history', room: room });
        $('msg-input').focus();
        renderSidebar();
        renderOnline();
        // Mobile: close drawer, show back btn
        if (typeof isMobile !== 'undefined' && isMobile) {
            closeSidebar();
            var bb = $('mnav-back');
            if (bb) bb.style.display = '';
        }
        if (typeof updateMobileBadges === 'function') updateMobileBadges();
    }

    function getPeer() {
        if (!state.currentRoom || !state.currentRoom.startsWith('dm:')) return null;
        var p = state.currentRoom.split(':');
        return p[1] === state.myName ? p[2] : p[1];
    }

    // MESSAGES
    function renderHistory(room, messages) {
        if (room !== state.currentRoom) return;
        var cont = $('messages');
        cont.innerHTML = '';
        if (!messages || !messages.length) { addSysMsg('Начало чата'); return; }
        messages.forEach(function(m) { appendMsg(m); });
        cont.scrollTop = cont.scrollHeight;
    }

    function onNewMsg(room, message) {
        if (room === state.currentRoom) {
            appendMsg(message);
            $('messages').scrollTop = $('messages').scrollHeight;
        } else {
            state.unread[room] = (state.unread[room] || 0) + 1;
            renderSidebar();
            renderOnline();
            if (typeof updateMobileBadges === 'function') updateMobileBadges();
            if (Notification && Notification.permission === 'granted')
                new Notification('MGV: ' + message.from, { body: message.text || '🎤 Медиа' });
        }
    }

    function onMsgDeleted(room, msgId) { var el = document.querySelector('[data-msgid="' + msgId + '"]'); if (el) el.remove(); }

    function onTyping(room, from) {
        if (room !== state.currentRoom || from === state.myName) return;
        var ti = $('typing-indicator');
        if (ti) ti.textContent = from + ' печатает...';
        clearTimeout(state.typingTimers[from]);
        state.typingTimers[from] = setTimeout(function() { if (ti) ti.textContent = ''; }, 2000);
    }

    function appendMsg(m) {
        var cont = $('messages'),
            isOwn = m.from === state.myName;
        var row = document.createElement('div');
        row.className = 'msg-row ' + (isOwn ? 'own' : 'other');
        row.dataset.msgid = m.id;
        var col = gc(m.from);
        var av = '<div class="msg-avatar" style="background:' + col + '22;color:' + col + '">' + ini(m.from) + '</div>';
        var delBtn = '<button class="msg-del" onclick="MGV.deleteMsg(\'' + m.id + '\')" title="Удалить">✕</button>';
        var body = '';
        if (!isOwn) body += '<div class="msg-meta"><span class="msg-author">' + esc(m.from) + '</span></div>';

        if (m.msgType === 'voice' && m.file) {
            var dur = m.file.duration || 0,
                uid = 'vm_' + m.id;
            body += '<div class="msg-bubble voice-bubble">' +
                '<div class="voice-msg" id="' + uid + '">' +
                '<button class="voice-play-btn" id="' + uid + '_btn" onclick="MGV.playVoice(\'' + esc(m.file.url) + '\',\'' + uid + '\')">▶</button>' +
                '<div class="voice-waveform"><canvas id="' + uid + '_cv" height="28"></canvas></div>' +
                '<span class="voice-duration" id="' + uid + '_dur">' + fmtDur(dur) + '</span>' +
                '</div>' + delBtn + '</div>';
        } else if (m.msgType === 'circle' && m.file) {
            var cid = 'circ_' + m.id;
            body += '<div class="circle-wrap" id="' + cid + '">' +
                '<video class="circle-vid" src="' + esc(m.file.url) + '" loop playsinline preload="metadata" onclick="MGV.playCircle(\'' + cid + '\')"></video>' +
                '<div class="circle-overlay" onclick="MGV.playCircle(\'' + cid + '\')">▶</div>' +
                '<span class="circle-dur">' + fmtDur(m.file.duration || 0) + '</span>' +
                delBtn + '</div>';
        } else if (m.file && isImage(m.file.mime)) {
            body += '<div class="msg-bubble">' + delBtn + '<img class="msg-img" src="' + esc(m.file.url) + '" onclick="MGV.openImage(\'' + esc(m.file.url) + '\')" loading="lazy"></div>';
        } else if (m.file && m.file.mime && m.file.mime.startsWith('video/')) {
            body += '<div class="msg-bubble">' + delBtn +
                '<video class="msg-video" src="' + esc(m.file.url) + '" controls playsinline preload="metadata"></video>' +
                '<div class="msg-file-info" style="font-size:11px;color:var(--text3);margin-top:4px">' + esc(m.file.name || '') + '</div>' +
                '</div>';
        } else if (m.file && m.file.mime && m.file.mime.startsWith('audio/')) {
            body += '<div class="msg-bubble">' + delBtn +
                '<audio class="msg-audio" src="' + esc(m.file.url) + '" controls preload="metadata"></audio>' +
                '<div class="msg-file-info" style="font-size:11px;color:var(--text3);margin-top:4px">' + esc(m.file.name || '') + '</div>' +
                '</div>';
        } else if (m.file) {
            body += '<div class="msg-bubble">' + delBtn +
                '<a class="msg-file" href="' + esc(m.file.url) + '" target="_blank" download>' +
                '<span class="msg-file-icon">' + fileIcon(m.file.mime) + '</span>' +
                '<div class="msg-file-info"><div class="msg-file-name">' + esc(m.file.name) + '</div>' +
                '<div class="msg-file-size">' + fmtSize(m.file.size || 0) + '</div></div></a>' +
                (m.text ? '<div style="margin-top:6px;font-size:13px">' + esc(m.text) + '</div>' : '') + '</div>';
        } else {
            body += '<div class="msg-bubble">' + delBtn + esc(m.text || '').replace(/\n/g, '<br>') + '</div>';
        }
        body += '<div class="msg-time">' + fmt(m.time) + '</div>';
        row.innerHTML = (isOwn ? '' : av) + '<div class="msg-body">' + body + '</div>' + (isOwn ? av : '');
        cont.appendChild(row);
        if (m.msgType === 'voice') setTimeout(function() { drawStaticWave(uid + '_cv', m.file && m.file.peaks); }, 60);
    }

    function addSysMsg(text) {
        var cont = $('messages'),
            row = document.createElement('div');
        row.className = 'msg-row sys';
        row.innerHTML = '<div class="msg-bubble">' + esc(text) + '</div>';
        cont.appendChild(row);
    }

    function fileIcon(m) {
        if (!m) return '📄';
        if (m.startsWith('image/')) return '🖼️';
        if (m.startsWith('video/')) return '🎬';
        if (m.startsWith('audio/')) return '🎵';
        if (m.includes('pdf')) return '📕';
        if (m.includes('zip') || m.includes('rar')) return '🗜️';
        return '📄';
    }

    function drawStaticWave(canvasId, peaks) {
        var canvas = document.getElementById(canvasId);
        if (!canvas) return;
        var W = canvas.parentElement ? canvas.parentElement.offsetWidth : 180;
        if (W < 10) W = 180;
        var H = 28;
        canvas.width = W;
        canvas.height = H;
        var ctx = canvas.getContext('2d'),
            bars = 36,
            bw = Math.max(2, (W - bars) / bars);
        ctx.fillStyle = 'rgba(148,163,184,0.45)';
        for (var i = 0; i < bars; i++) {
            var h = peaks && peaks.length ? peaks[Math.floor(i * peaks.length / bars)] * H : (Math.sin(i * 0.8) * 0.3 + 0.5) * H * 0.85 + H * 0.05;
            h = Math.max(3, h);
            ctx.fillRect(i * (bw + 1), (H - h) / 2, bw, h);
        }
    }

    // SEND
    function sendMsg() {
        var input = $('msg-input'),
            text = input.value.trim();
        if (!state.currentRoom) return;
        if (state.pendingFile) { dispatchMsg({ file: state.pendingFile, text: text });
            clearPendingFile();
            input.value = '';
            updateButtons(); return; }
        if (!text) return;
        input.value = '';
        updateButtons();
        dispatchMsg({ text: text });
    }

    function dispatchMsg(data) {
        var p = { text: data.text || '', file: data.file || null, msgType: data.msgType || null };
        if (state.currentRoomType === 'dm') wsSend(Object.assign({ type: 'dm', to: getPeer() }, p));
        else wsSend(Object.assign({ type: 'channel-msg', room: state.currentRoom }, p));
    }

    function onTypingInput() {
        updateButtons();
        clearTimeout(state.typingTimeout);
        if ($('msg-input').value.trim())
            state.typingTimeout = setTimeout(function() { wsSend({ type: 'typing', room: state.currentRoom }); }, 300);
        var inp = $('msg-input');
        inp.style.height = 'auto';
        inp.style.height = Math.min(inp.scrollHeight, 120) + 'px';
    }

    function updateButtons() {
        var has = $('msg-input').value.trim().length > 0 || !!state.pendingFile;
        $('btn-voice').style.display = has ? 'none' : 'flex';
        $('btn-circle').style.display = has ? 'none' : 'flex';
        $('send-btn').style.display = has ? 'flex' : 'none';
    }

    function deleteMsg(msgId) { if (!confirm('Удалить?')) return;
        wsSend({ type: 'delete-msg', room: state.currentRoom, msgId: msgId }); }

    // UPLOAD
    function handleFileSelect(e) { var f = e.target.files[0]; if (!f) return;
        uploadFile(f);
        e.target.value = ''; }

    function uploadFile(file, msgType, meta) {
        if (file.size > 100 * 1024 * 1024) { alert('Макс 100MB'); return; }
        if (!msgType) { $('upload-preview-name').textContent = file.name + ' (' + fmtSize(file.size) + ')';
            $('upload-preview').style.display = 'flex'; }
        var fd = new FormData();
        fd.append('file', file);
        if (meta) fd.append('meta', JSON.stringify(meta));
        fetch('/upload?user=' + encodeURIComponent(state.myName), { method: 'POST', body: fd })
            .then(function(r) { return r.json(); })
            .then(function(data) {
                if (data.error) { alert('Ошибка: ' + data.error);
                    clearPendingFile(); return; }
                if (meta && meta.duration !== undefined) data.duration = meta.duration;
                if (meta && meta.peaks) data.peaks = meta.peaks;
                if (msgType) { $('upload-preview').style.display = 'none';
                    dispatchMsg({ msgType: msgType, file: data }); } else { state.pendingFile = data;
                    updateButtons(); }
            })
            .catch(function(err) { alert('Ошибка загрузки');
                clearPendingFile();
                console.error(err); });
    }

    function clearPendingFile() { state.pendingFile = null;
        $('upload-preview').style.display = 'none';
        updateButtons(); }

    // ═══ VOICE MESSAGE ═══
    async function startVoice() {
        if (!state.currentRoom) return;
        try { voiceRec.stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch (e) { alert('Нет микрофона: ' + e.message); return; }

        var AC = window.AudioContext || window.webkitAudioContext;
        voiceRec.actx = new AC();
        var src = voiceRec.actx.createMediaStreamSource(voiceRec.stream);
        voiceRec.analyser = voiceRec.actx.createAnalyser();
        voiceRec.analyser.fftSize = 256;
        src.connect(voiceRec.analyser);
        voiceRec.peaks = [];

        var mime = 'audio/webm;codecs=opus';
        if (!MediaRecorder.isTypeSupported(mime)) mime = 'audio/webm';
        if (!MediaRecorder.isTypeSupported(mime)) mime = 'audio/ogg;codecs=opus';
        if (!MediaRecorder.isTypeSupported(mime)) mime = 'audio/ogg';
        if (!MediaRecorder.isTypeSupported(mime)) mime = '';
        var opts = mime ? { mimeType: mime } : {};
        voiceRec.mediaRecorder = new MediaRecorder(voiceRec.stream, opts);
        voiceRec.chunks = [];
        voiceRec.mediaRecorder.ondataavailable = function(e) { if (e.data && e.data.size > 0) voiceRec.chunks.push(e.data); };
        voiceRec.mediaRecorder.onstop = onVoiceStop;
        voiceRec.mediaRecorder.start(100);

        voiceRec.seconds = 0;
        $('rec-time').textContent = '0:00';
        $('voice-recorder').classList.add('active');
        voiceRec.timerInt = setInterval(function() {
            voiceRec.seconds++;
            $('rec-time').textContent = fmtDur(voiceRec.seconds);
            if (voiceRec.seconds >= 300) stopVoice();
        }, 1000);
        drawRecWave();
    }

    function drawRecWave() {
        var canvas = $('rec-wave');
        if (!canvas || !voiceRec.analyser) return;
        var W = canvas.offsetWidth || 200,
            H = 24;
        canvas.width = W;
        canvas.height = H;
        var ctx = canvas.getContext('2d');
        var data = new Uint8Array(voiceRec.analyser.frequencyBinCount);
        voiceRec.analyser.getByteFrequencyData(data);
        var avg = 0;
        for (var j = 0; j < data.length; j++) avg += data[j];
        voiceRec.peaks.push(avg / data.length / 255);
        ctx.clearRect(0, 0, W, H);
        var bars = Math.floor(W / 5);
        for (var i = 0; i < bars; i++) {
            var idx = Math.floor(i * data.length / bars),
                v = Math.max(2, (data[idx] / 255) * H);
            ctx.fillStyle = data[idx] > 50 ? 'var(--accent)' : 'rgba(148,163,184,0.3)';
            ctx.fillRect(i * 5, (H - v) / 2, 3, v);
        }
        voiceRec.animFrame = requestAnimationFrame(drawRecWave);
    }

    function stopVoice() { if (voiceRec.mediaRecorder && voiceRec.mediaRecorder.state !== 'inactive') voiceRec.mediaRecorder.stop(); }

    function cancelVoice() {
        if (voiceRec.mediaRecorder && voiceRec.mediaRecorder.state !== 'inactive') { voiceRec.mediaRecorder.onstop = null;
            voiceRec.mediaRecorder.stop(); }
        cleanupVoice();
    }

    function onVoiceStop() {
        var duration = voiceRec.seconds,
            peaks = normPeaks(voiceRec.peaks, 40);
        var mime = (voiceRec.chunks[0] && voiceRec.chunks[0].type) || 'audio/webm';
        var blob = new Blob(voiceRec.chunks, { type: mime }),
            ext = mime.includes('ogg') ? '.ogg' : '.webm';
        var file = new File([blob], 'voice_' + Date.now() + ext, { type: mime });
        cleanupVoice();
        uploadFile(file, 'voice', { duration: duration, peaks: peaks });
    }

    function cleanupVoice() {
        clearInterval(voiceRec.timerInt);
        cancelAnimationFrame(voiceRec.animFrame);
        if (voiceRec.actx) { try { voiceRec.actx.close(); } catch (e) {} }
        if (voiceRec.stream) voiceRec.stream.getTracks().forEach(function(t) { t.stop(); });
        voiceRec.stream = null;
        voiceRec.analyser = null;
        voiceRec.actx = null;
        $('voice-recorder').classList.remove('active');
    }

    function normPeaks(arr, len) {
        var r = [];
        for (var i = 0; i < len; i++) { var idx = Math.floor(i * arr.length / len);
            r.push(Math.max(0.04, Math.min(1, arr[idx] || 0))); }
        return r;
    }

    function playVoice(url, uid) {
        var btn = $(uid + '_btn'),
            durEl = $(uid + '_dur');
        if (currentAudio && !currentAudio.paused) {
            currentAudio.pause();
            currentAudio.dispatchEvent(new Event('ended'));
            if (currentAudio._uid === uid) { currentAudio = null; return; }
        }
        var audio = new Audio(url);
        audio._uid = uid;
        currentAudio = audio;
        if (btn) btn.textContent = '⏸';
        audio.addEventListener('timeupdate', function() { if (durEl) durEl.textContent = fmtDur(audio.currentTime); });
        audio.addEventListener('ended', function() { if (btn) btn.textContent = '▶'; if (durEl && audio.duration) durEl.textContent = fmtDur(audio.duration);
            currentAudio = null; });
        audio.addEventListener('error', function() { if (btn) btn.textContent = '▶';
            currentAudio = null; });
        audio.play().catch(function(e) { console.error(e); if (btn) btn.textContent = '▶'; });
    }

    // ═══ CIRCLE VIDEO ═══
    async function startCircle() {
        if (!state.currentRoom) return;
        try {
            circleRec.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 480 }, height: { ideal: 480 } }, audio: true });
        } catch (e) { alert('Нет камеры/микрофона: ' + e.message); return; }

        var prev = $('circle-preview');
        prev.srcObject = circleRec.stream;
        prev.play().catch(function() {});
        $('circle-recorder').classList.add('active');

        var mime = 'video/webm;codecs=vp9,opus';
        if (!MediaRecorder.isTypeSupported(mime)) mime = 'video/webm;codecs=vp8,opus';
        if (!MediaRecorder.isTypeSupported(mime)) mime = 'video/webm';
        if (!MediaRecorder.isTypeSupported(mime)) mime = '';
        var opts = mime ? { mimeType: mime, videoBitsPerSecond: 500000 } : {};
        circleRec.mediaRecorder = new MediaRecorder(circleRec.stream, opts);
        circleRec.chunks = [];
        circleRec.mediaRecorder.ondataavailable = function(e) { if (e.data && e.data.size > 0) circleRec.chunks.push(e.data); };
        circleRec.mediaRecorder.onstop = onCircleStop;
        circleRec.mediaRecorder.start(100);

        circleRec.seconds = 0;
        $('circle-time').textContent = '0:00';
        updateCircleRing(0);
        circleRec.timerInt = setInterval(function() {
            circleRec.seconds++;
            $('circle-time').textContent = fmtDur(circleRec.seconds);
            updateCircleRing(circleRec.seconds / 60);
            if (circleRec.seconds >= 60) stopCircle();
        }, 1000);
    }

    function updateCircleRing(f) {
        var svg = $('circle-progress');
        if (!svg) return;
        var r = 113,
            circ = 2 * Math.PI * r;
        svg.style.strokeDashoffset = circ * (1 - f);
    }

    function stopCircle() { if (circleRec.mediaRecorder && circleRec.mediaRecorder.state !== 'inactive') circleRec.mediaRecorder.stop(); }

    function cancelCircle() {
        if (circleRec.mediaRecorder && circleRec.mediaRecorder.state !== 'inactive') { circleRec.mediaRecorder.onstop = null;
            circleRec.mediaRecorder.stop(); }
        cleanupCircle();
    }

    function onCircleStop() {
        var duration = circleRec.seconds;
        var blob = new Blob(circleRec.chunks, { type: 'video/webm' });
        var file = new File([blob], 'circle_' + Date.now() + '.webm', { type: 'video/webm' });
        cleanupCircle();
        uploadFile(file, 'circle', { duration: duration });
    }

    function cleanupCircle() {
        clearInterval(circleRec.timerInt);
        if (circleRec.stream) circleRec.stream.getTracks().forEach(function(t) { t.stop(); });
        circleRec.stream = null;
        $('circle-recorder').classList.remove('active');
        var prev = $('circle-preview');
        if (prev) prev.srcObject = null;
    }

    function playCircle(wrapId) {
        var wrap = document.getElementById(wrapId);
        if (!wrap) return;
        var vid = wrap.querySelector('.circle-vid'),
            overlay = wrap.querySelector('.circle-overlay');
        if (!vid) return;
        if (vid.paused) { vid.play().catch(function() {}); if (overlay) overlay.style.opacity = '0';
            vid.onended = function() { if (overlay) overlay.style.opacity = '1'; }; } else { vid.pause();
            vid.currentTime = 0; if (overlay) overlay.style.opacity = '1'; }
    }

    // LIGHTBOX
    function openImage(url) { $('lightbox-img').src = url;
        $('lightbox').classList.add('active'); }

    // CHANNELS
    function openCreateChannel() { if (state.myRole !== 'admin') return;
        $('create-channel-modal').classList.add('active'); }

    function closeCreateChannel() { $('create-channel-modal').classList.remove('active'); }

    function submitCreateChannel() {
        var name = $('new-ch-name').value.trim(),
            desc = $('new-ch-desc').value.trim();
        if (!name) return;
        wsSend({ type: 'create-channel', name: name, description: desc, channelType: 'public' });
        closeCreateChannel();
        $('new-ch-name').value = '';
        $('new-ch-desc').value = '';
    }

    // ═══ WebRTC ═══
    async function getIce() {
        if (cachedIce) return cachedIce;
        try { var r = await fetch(TURN_API);
            cachedIce = await r.json(); return cachedIce; } catch (e) { return [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }]; }
    }

    async function makePc(remoteName) {
        if (rtc.pc) { try { rtc.pc.close(); } catch (e) {}
            rtc.pc = null; }
        rtc.remoteDescSet = false;
        rtc.iceQueue = [];
        var iceServers = await getIce();
        rtc.pc = new RTCPeerConnection({ iceServers: iceServers, bundlePolicy: 'max-bundle' });
        rtc.localStream.getTracks().forEach(function(t) { rtc.pc.addTrack(t, rtc.localStream); });
        rtc.pc.onicecandidate = function(e) { if (e.candidate) wsSend({ type: 'ice', to: remoteName, candidate: e.candidate }); };
        rtc.pc.ontrack = function(e) {
            var track = e.track;
            if (track.kind === 'audio') {
                var aud = $('remote-audio');
                if (!aud.srcObject) aud.srcObject = new MediaStream();
                aud.srcObject.addTrack(track);
                aud.play().catch(function() {});
            } else if (track.kind === 'video') {
                var vid = $('remote-video');
                if (!vid.srcObject) vid.srcObject = new MediaStream();
                vid.srcObject.addTrack(track);
                vid.style.display = 'block';
                $('call-no-video').style.display = 'none';
                $('call-top-info').style.display = 'flex';
                vid.play().catch(function() {});
            }
        };
        rtc.pc.onconnectionstatechange = function() {
            var s = rtc.pc && rtc.pc.connectionState;
            console.log('[RTC]', s);
            if (s === 'connected') { setCallStatus('СОЕДИНЕНО'); if (!rtc.timerInt) startCallTimer(); }
            if (s === 'failed') { addSysMsg('Связь потеряна');
                rtcCleanup(); }
        };
        rtc.pc.oniceconnectionstatechange = function() {
            var s = rtc.pc && rtc.pc.iceConnectionState;
            console.log('[ICE]', s);
            if (s === 'connected' || s === 'completed') { setCallStatus('СОЕДИНЕНО'); if (!rtc.timerInt) startCallTimer(); }
            if (s === 'failed') { addSysMsg('ICE failed');
                rtcCleanup(); }
        };
    }

    async function flushIceQueue() {
        while (rtc.iceQueue.length) { try { await rtc.pc.addIceCandidate(new RTCIceCandidate(rtc.iceQueue.shift())); } catch (e) {} }
    }

    async function startCall(type) {
        var peer = state.currentPeer;
        if (!peer) return;
        rtc.withVideo = (type === 'video');
        try {
            rtc.localStream = await navigator.mediaDevices.getUserMedia({
                audio: true,
                video: rtc.withVideo ? { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' } : false
            });
        } catch (e) {
            if (rtc.withVideo) {
                try { rtc.localStream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch (e2) { alert('Нет доступа: ' + e2.message); return; }
                rtc.withVideo = false;
            } else { alert('Нет доступа к микрофону: ' + e.message); return; }
        }

        showCallOverlay(peer);
        setCallStatus('ПОДГОТОВКА...');
        if (rtc.withVideo) { var lve = $('local-video-el');
            lve.srcObject = rtc.localStream;
            lve.play().catch(function() {});
            $('local-video').style.display = 'block'; }
        await makePc(peer);
        var offer = await rtc.pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
        await rtc.pc.setLocalDescription(offer);
        wsSend({ type: 'call-offer', to: peer, offer: rtc.pc.localDescription, fromName: state.myName, withVideo: rtc.withVideo });
        setCallStatus('ЖДЁМ ОТВЕТА...');
    }

    function rtcHandleOffer(msg) {
        rtc.incOffer = msg.offer;
        rtc.incFrom = msg.fromName || msg.from;
        rtc.incWithVideo = !!msg.withVideo;
        $('inc-name').textContent = rtc.incFrom;
        $('inc-label').textContent = rtc.incWithVideo ? '📹 Видеозвонок' : '📞 Голосовой звонок';
        var avb = $('ans-video-btn');
        if (avb) avb.style.display = rtc.incWithVideo ? 'inline-block' : 'none';
        $('incoming-call').classList.add('active');
        try {
            var ac = new(window.AudioContext || window.webkitAudioContext)(),
                osc = ac.createOscillator(),
                g = ac.createGain();
            osc.frequency.value = 480;
            g.gain.value = 0.06;
            osc.connect(g);
            g.connect(ac.destination);
            osc.start();
            setTimeout(function() { try { osc.stop();
                    ac.close(); } catch (e) {} }, 900);
        } catch (e) {}
    }

    async function answerCall(withVideo) {
        $('incoming-call').classList.remove('active');
        rtc.withVideo = !!withVideo && rtc.incWithVideo;
        try {
            rtc.localStream = await navigator.mediaDevices.getUserMedia({
                audio: true,
                video: rtc.withVideo ? { width: { ideal: 640 }, height: { ideal: 480 } } : false
            });
        } catch (e) {
            try { rtc.localStream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch (e2) { alert('Нет доступа: ' + e2.message); return; }
            rtc.withVideo = false;
        }
        if (rtc.withVideo) { var lve = $('local-video-el');
            lve.srcObject = rtc.localStream;
            lve.play().catch(function() {});
            $('local-video').style.display = 'block'; }
        showCallOverlay(rtc.incFrom);
        setCallStatus('СОЕДИНЯЕМСЯ...');
        await makePc(rtc.incFrom);
        await rtc.pc.setRemoteDescription(new RTCSessionDescription(rtc.incOffer));
        rtc.remoteDescSet = true;
        await flushIceQueue();
        var answer = await rtc.pc.createAnswer();
        await rtc.pc.setLocalDescription(answer);
        wsSend({ type: 'call-answer', to: rtc.incFrom, answer: rtc.pc.localDescription, withVideo: rtc.withVideo });
    }

    function declineCall() {
        $('incoming-call').classList.remove('active');
        wsSend({ type: 'call-decline', to: rtc.incFrom });
        rtc.incOffer = null;
        rtc.incFrom = null;
    }

    async function rtcHandleAnswer(msg) {
        if (!rtc.pc) return;
        await rtc.pc.setRemoteDescription(new RTCSessionDescription(msg.answer));
        rtc.remoteDescSet = true;
        await flushIceQueue();
    }

    async function rtcHandleIce(msg) {
        if (!rtc.pc || !msg.candidate) return;
        if (rtc.remoteDescSet) { try { await rtc.pc.addIceCandidate(new RTCIceCandidate(msg.candidate)); } catch (e) {} } else rtc.iceQueue.push(msg.candidate);
    }

    function endCall() { var peer = state.currentPeer || rtc.incFrom; if (peer) wsSend({ type: 'call-end', to: peer });
        rtcCleanup(); }

    function rtcRemoteEnd() { addSysMsg('Звонок завершён');
        rtcCleanup(); }

    function rtcCallDeclined() { setCallStatus('ОТКЛОНЕНО');
        setTimeout(rtcCleanup, 1500); }

    function rtcCleanup() {
        if (rtc.pc) { try { rtc.pc.close(); } catch (e) {}
            rtc.pc = null; }
        if (rtc.localStream) { rtc.localStream.getTracks().forEach(function(t) { t.stop(); });
            rtc.localStream = null; }
        $('call-overlay').classList.remove('active');
        var rv = $('remote-video');
        if (rv) { try { rv.srcObject = null; } catch (e) {}
            rv.style.display = 'none'; }
        var lve = $('local-video-el');
        if (lve) { try { lve.srcObject = null; } catch (e) {} }
        $('local-video').style.display = 'none';
        var ra = $('remote-audio');
        if (ra) { try { ra.srcObject = null; } catch (e) {} }
        $('call-no-video').style.display = 'flex';
        $('call-top-info').style.display = 'none';
        if (rtc.timerInt) { clearInterval(rtc.timerInt);
            rtc.timerInt = null; }
        $('call-timer').textContent = '';
        var ct2 = $('call-timer2');
        if (ct2) ct2.textContent = '';
        rtc.remoteDescSet = false;
        rtc.iceQueue = [];
        rtc.withVideo = false;
        rtc.isMuted = false;
        rtc.isVideoOff = false;
        $('mute-btn').textContent = '🎤';
        $('mute-btn').classList.remove('muted');
        $('video-btn').classList.remove('off');
        $('video-btn').textContent = '📹';
    }

    function toggleMute() {
        if (!rtc.localStream) return;
        rtc.isMuted = !rtc.isMuted;
        rtc.localStream.getAudioTracks().forEach(function(t) { t.enabled = !rtc.isMuted; });
        $('mute-btn').textContent = rtc.isMuted ? '🔇' : '🎤';
        $('mute-btn').classList.toggle('muted', rtc.isMuted);
    }

    function toggleVideo() {
        if (!rtc.localStream) return;
        rtc.isVideoOff = !rtc.isVideoOff;
        rtc.localStream.getVideoTracks().forEach(function(t) { t.enabled = !rtc.isVideoOff; });
        $('video-btn').classList.toggle('off', rtc.isVideoOff);
        $('video-btn').textContent = rtc.isVideoOff ? '🚫' : '📹';
        $('local-video').style.display = rtc.isVideoOff ? 'none' : 'block';
    }

    function showCallOverlay(peer) {
        var col = gc(peer),
            av = $('call-avatar');
        av.textContent = ini(peer);
        av.style.background = col + '22';
        av.style.color = col;
        $('call-peer-name').textContent = peer;
        var ctn = $('call-top-name');
        if (ctn) ctn.textContent = peer;
        $('call-overlay').classList.add('active');
        $('call-no-video').style.display = 'flex';
        $('call-top-info').style.display = 'none';
    }

    function setCallStatus(text) { $('call-status').textContent = text; var cts = $('call-top-status'); if (cts) cts.textContent = text; }

    function startCallTimer() {
        rtc.timerStart = Date.now();
        rtc.timerInt = setInterval(function() {
            var s = Math.floor((Date.now() - rtc.timerStart) / 1000),
                t = fmtDur(s);
            $('call-timer').textContent = t;
            var ct2 = $('call-timer2');
            if (ct2) ct2.textContent = t;
        }, 1000);
    }

    // INIT
    // ═══════════════════════════════════════
    // MOBILE UX
    // ═══════════════════════════════════════
    var isMobile = false;
    var sidebarMode = 'channels'; // 'channels' | 'users'

    function checkMobile() {
        isMobile = window.innerWidth <= 700;
    }

    function openSidebar(mode) {
        sidebarMode = mode || sidebarMode;
        var sidebar = document.querySelector('.sidebar');
        var overlay = $('sidebar-overlay');
        if (!sidebar) return;

        // Show right tab content
        var chList = $('channel-list'),
            ouList = $('online-list');
        var chHdr = document.querySelector('.sidebar-section');
        // Find sections
        var sections = document.querySelectorAll('.sidebar-section');
        if (sidebarMode === 'channels') {
            if (chList) chList.style.display = '';
            if (sections[0]) sections[0].style.display = '';
            if (ouList) ouList.style.display = 'none';
            if (sections[1]) sections[1].style.display = 'none';
            document.querySelector('.sidebar-divider') && (document.querySelector('.sidebar-divider').style.display = 'none');
        } else {
            if (chList) chList.style.display = 'none';
            if (sections[0]) sections[0].style.display = 'none';
            if (ouList) ouList.style.display = '';
            if (sections[1]) sections[1].style.display = '';
            document.querySelector('.sidebar-divider') && (document.querySelector('.sidebar-divider').style.display = 'none');
        }

        sidebar.classList.add('open');
        if (overlay) { overlay.classList.add('visible'); }
        // Update nav active
        updateMobileNav(mode);
    }

    function closeSidebar() {
        var sidebar = document.querySelector('.sidebar');
        var overlay = $('sidebar-overlay');
        if (sidebar) sidebar.classList.remove('open');
        if (overlay) { overlay.classList.remove('visible'); }
    }

    function mobileTab(tab) {
        if (!isMobile) { return; }
        sidebarMode = tab;
        // If sidebar already open on same tab — close it
        var sidebar = document.querySelector('.sidebar');
        if (sidebar && sidebar.classList.contains('open') && sidebarMode === tab) {
            closeSidebar();
            return;
        }
        openSidebar(tab);
    }

    function mobileBack() {
        // Go back to "no chat" view
        $('no-chat').style.display = '';
        $('chat-view').style.display = 'none';
        state.currentRoom = null;
        $('mnav-back').style.display = 'none';
        document.querySelectorAll('.sidebar-item').forEach(function(el) { el.classList.remove('active'); });
    }

    function updateMobileNav(mode) {
        var btns = {
            channels: $('mnav-channels'),
            users: $('mnav-users')
        };
        Object.keys(btns).forEach(function(k) {
            if (btns[k]) btns[k].classList.toggle('active', k === mode);
        });
    }

    function updateMobileBadges() {
        var chTotal = 0,
            dmTotal = 0;
        Object.keys(state.unread).forEach(function(room) {
            if (state.unread[room] > 0) {
                if (room.startsWith('dm:')) dmTotal += state.unread[room];
                else chTotal += state.unread[room];
            }
        });
        var chB = $('mnav-ch-badge'),
            dmB = $('mnav-dm-badge');
        if (chB) { chB.textContent = chTotal;
            chB.style.display = chTotal ? '' : 'none'; }
        if (dmB) { dmB.textContent = dmTotal;
            dmB.style.display = dmTotal ? '' : 'none'; }
    }

    // Mobile hooks called from openRoom and onNewMsg directly

    // Touch swipe support for sidebar
    function initSwipe() {
        var startX = 0,
            startY = 0;
        document.addEventListener('touchstart', function(e) {
            startX = e.touches[0].clientX;
            startY = e.touches[0].clientY;
        }, { passive: true });
        document.addEventListener('touchend', function(e) {
            var dx = e.changedTouches[0].clientX - startX;
            var dy = e.changedTouches[0].clientY - startY;
            // Swipe up from bottom → open sidebar
            if (Math.abs(dy) > Math.abs(dx) && dy < -60 && startY > window.innerHeight * 0.7) {
                var sidebar = document.querySelector('.sidebar');
                if (sidebar && !sidebar.classList.contains('open')) openSidebar(sidebarMode);
            }
            // Swipe down → close sidebar
            if (Math.abs(dy) > Math.abs(dx) && dy > 60) {
                closeSidebar();
            }
        }, { passive: true });
    }

    // ═══════════════════════════════════════
    // INIT
    // ═══════════════════════════════════════
    document.addEventListener('DOMContentLoaded', function() {
        init();
        checkMobile();
        window.addEventListener('resize', checkMobile);
        initSwipe();
    });

    function init() {
        $('l-name').addEventListener('keydown', function(e) { if (e.key === 'Enter') $('l-pass').focus(); });
        $('l-pass').addEventListener('keydown', function(e) { if (e.key === 'Enter') doLogin(); });
        $('login-btn').addEventListener('click', doLogin);
        $('msg-input').addEventListener('keydown', function(e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault();
                sendMsg(); } });
        $('msg-input').addEventListener('input', onTypingInput);
        $('file-input').addEventListener('change', handleFileSelect);
        $('upload-cancel-btn').addEventListener('click', clearPendingFile);
        $('rec-cancel').addEventListener('click', cancelVoice);
        $('rec-send').addEventListener('click', stopVoice);
        var cv = $('chat-view');
        cv.addEventListener('dragover', function(e) { e.preventDefault(); });
        cv.addEventListener('drop', function(e) { e.preventDefault(); var f = e.dataTransfer.files[0]; if (f) uploadFile(f); });
        $('lightbox').addEventListener('click', function() { this.classList.remove('active'); });
        if (Notification && Notification.permission !== 'granted') Notification.requestPermission();
        if ($('admin-link')) $('admin-link').style.display = 'none';
        var n = localStorage.getItem('mgv_n'),
            p = localStorage.getItem('mgv_p');
        if (n && p) { state.myName = n;
            state.myPass = p;
            connectWS(); }
    }

    window.MGV = {
        doLogin,
        doLogout,
        sendMsg,
        deleteMsg,
        openImage,
        startVoice,
        stopVoice,
        cancelVoice,
        playVoice,
        startCircle,
        stopCircle,
        cancelCircle,
        playCircle,
        startCall,
        endCall,
        answerCall,
        declineCall,
        toggleMute,
        toggleVideo,
        openCreateChannel,
        closeCreateChannel,
        submitCreateChannel,
        clearPendingFile,
        openRoom,
        mobileTab,
        mobileBack,
        closeSidebar,
        attachFile: function() { $('file-input').click(); }
    };

})();
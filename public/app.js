// MGV Messenger — app.js v4
(function() {
    'use strict';

    var S = {
        ws: null,
        name: '',
        pass: '',
        role: 'user',
        room: null,
        rType: null,
        peer: null,
        channels: [],
        online: [],
        unread: {},
        pendingFile: null,
        typingT: null,
        typingMap: {},
        tab: 'ch'
    };

    var RTC = {
        pc: null,
        local: null,
        muted: false,
        vidOff: false,
        withVid: false,
        timer: null,
        t0: null,
        incOffer: null,
        incFrom: null,
        incVid: false,
        iceQ: [],
        sdpSet: false
    };

    var VR = { mr: null, stream: null, chunks: [], timer: null, secs: 0, actx: null, an: null, raf: null, peaks: [] };
    var CR = { mr: null, stream: null, chunks: [], timer: null, secs: 0 };
    var VP = { el: null, uid: null };

    var TURN = 'https://mgv.metered.live/api/v1/turn/credentials?apiKey=c26a2ef76f54f5c0d4e8f66a0d11cb69aa2b';
    var iceCache = null;

    var COLORS = ['#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#ef4444', '#06b6d4', '#84cc16'];

    function gc(n) { var h = 0; for (var i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) % COLORS.length; return COLORS[h]; }

    function ini(n) { return (n || '?')[0].toUpperCase(); }

    function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

    function fmtT(t) { return new Date(t).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' }); }

    function fmtD(s) { s = Math.max(0, Math.round(+s || 0)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }

    function fmtS(b) { b = +b || 0; if (b < 1024) return b + 'B'; if (b < 1048576) return (b / 1024).toFixed(1) + 'KB'; return (b / 1048576).toFixed(1) + 'MB'; }

    function isImg(m) { return /^image\//.test(m || ''); }

    function isVid(m) { return /^video\//.test(m || ''); }

    function $(i) { return document.getElementById(i); }

    function q(sel) { return document.querySelector(sel); }

    function qa(sel) { return document.querySelectorAll(sel); }

    // ═══ AUTH ═══
    function doLogin() {
        var n = ($('l-name').value || '').trim(),
            p = $('l-pass').value || '';
        if (!n) { setErr('Введите имя'); return; }
        if (!p) { setErr('Введите пароль'); return; }
        setErr('');
        S.name = n;
        S.pass = p;
        connect();
    }

    function doLogout() { localStorage.removeItem('mgv_n');
        localStorage.removeItem('mgv_p');
        location.reload(); }

    function setErr(m) { $('login-err').textContent = m; }

    // ═══ WS ═══
    function connect() {
        var proto = location.protocol === 'https:' ? 'wss' : 'ws';
        S.ws = new WebSocket(proto + '://' + location.host);
        S.ws.onopen = function() { wsSend({ type: 'auth', name: S.name, pass: S.pass }); };
        S.ws.onclose = function() { setDots(false);
            setTimeout(connect, 2000); };
        S.ws.onmessage = function(e) { try { handle(JSON.parse(e.data)); } catch (ex) { console.error(ex); } };
    }

    function wsSend(o) { if (S.ws && S.ws.readyState === 1) S.ws.send(JSON.stringify(o)); }

    function setDots(on) {
        var c = 'var(--' + (on ? 'green' : 'red') + ')';
        [$('conn-dot'), $('conn-dot-m')].forEach(function(d) { if (d) d.style.background = c; });
    }

    // ═══ HANDLE ═══
    function handle(m) {
        switch (m.type) {
            case 'auth-ok':
                authOk(m);
                break;
            case 'auth-fail':
                setErr(m.reason || 'Ошибка');
                $('login-screen').style.display = 'flex';
                break;
            case 'kicked':
                alert(m.reason);
                doLogout();
                break;
            case 'channels':
                S.channels = m.channels;
                renderCh();
                break;
            case 'online':
                S.online = m.users;
                renderDm();
                break;
            case 'history':
                renderHist(m.room, m.messages);
                break;
            case 'channel-msg':
                onMsg(m.room, m.message);
                break;
            case 'msg-deleted':
                onDel(m.room, m.msgId);
                break;
            case 'typing':
                onTyping(m.room, m.from);
                break;
            case 'call-offer':
                rtcOffer(m);
                break;
            case 'call-answer':
                rtcAnswer(m);
                break;
            case 'ice':
                rtcIce(m);
                break;
            case 'call-end':
                rtcRemEnd();
                break;
            case 'call-decline':
                rtcDecline();
                break;
        }
    }

    function authOk(m) {
        S.name = m.name;
        S.role = m.role;
        localStorage.setItem('mgv_n', S.name);
        localStorage.setItem('mgv_p', S.pass);
        $('login-screen').style.display = 'none';
        $('app').classList.add('visible');
        [$('topbar-user'), $('topbar-user-m')].forEach(function(el) { if (el) el.textContent = S.name; });
        setDots(true);
        if (S.role === 'admin') {
            var al = $('admin-link');
            if (al) al.style.display = 'flex';
            var ba = $('btn-add-ch');
            if (ba) ba.style.display = '';
        }
    }

    // ═══ TABS ═══
    function switchTab(t) {
        S.tab = t;
        $('tab-ch').classList.toggle('on', t === 'ch');
        $('tab-dm').classList.toggle('on', t === 'dm');
        $('panel-ch').style.display = t === 'ch' ? '' : 'none';
        $('panel-dm').style.display = t === 'dm' ? '' : 'none';
    }

    // ═══ LISTS ═══
    function renderCh() {
        var box = $('channel-list');
        if (!box) return;
        box.innerHTML = '';
        S.channels.forEach(function(ch) {
            var d = document.createElement('div');
            d.className = 's-item' + (S.room === ch.id ? ' on' : '');
            d.dataset.id = ch.id;
            var u = S.unread[ch.id] || 0;
            d.innerHTML = '<span class="s-item-icon">#</span><span class="s-item-name">' + esc(ch.name) + '</span>' +
                (u ? '<span class="s-item-badge">' + u + '</span>' : '');
            d.addEventListener('click', function() { openRoom(ch.id, 'ch', null); });
            box.appendChild(d);
        });
        updBadges();
    }

    function renderDm() {
        var box = $('online-list');
        if (!box) return;
        box.innerHTML = '';
        var others = S.online.filter(function(n) { return n !== S.name; });
        others.forEach(function(nm) {
            var col = gc(nm),
                dr = dmKey(nm),
                u = S.unread[dr] || 0;
            var d = document.createElement('div');
            d.className = 'u-row';
            d.innerHTML = '<div class="u-av" style="background:' + col + '22;color:' + col + '">' + ini(nm) + '</div>' +
                '<span class="u-name">' + esc(nm) + '</span>' +
                (u ? '<span class="u-badge">' + u + '</span>' : '<span class="u-dot"></span>');
            d.addEventListener('click', function() { openRoom(dr, 'dm', nm); });
            box.appendChild(d);
        });
        updBadges();
    }

    function dmKey(other) { return 'dm:' + [S.name, other].sort().join(':'); }

    function updBadges() {
        var ch = 0,
            dm = 0;
        Object.keys(S.unread).forEach(function(r) {
            var v = S.unread[r] || 0;
            if (!v) return;
            if (r.startsWith('dm:')) dm += v;
            else ch += v;
        });
        var bc = $('badge-ch');
        if (bc) { bc.textContent = ch;
            bc.style.display = ch ? '' : 'none'; }
        var bd = $('badge-dm');
        if (bd) { bd.textContent = dm;
            bd.style.display = dm ? '' : 'none'; }
    }

    // ═══ OPEN ROOM ═══
    function openRoom(room, type, peer) {
        S.room = room;
        S.rType = type;
        S.peer = peer;
        S.unread[room] = 0;

        // Highlight
        qa('.s-item').forEach(function(el) { el.classList.remove('on'); });
        var a = q('.s-item[data-id="' + room + '"]');
        if (a) a.classList.add('on');

        var isDm = type === 'dm';
        var ch = isDm ? null : S.channels.find(function(c) { return c.id === room; });
        var label = isDm ? peer : ('#' + (ch ? ch.name : room));
        var sub = isDm ? 'Личное сообщение' : ((ch && ch.description) || '');

        // Desktop headers
        var cn = $('chat-name');
        if (cn) cn.textContent = label;
        var cd = $('chat-desc');
        if (cd) cd.textContent = sub;
        var cb = $('call-buttons');
        if (cb) cb.style.display = isDm ? 'flex' : 'none';

        // Mobile headers
        var mn = $('mob-chat-name');
        if (mn) mn.textContent = label;
        var ms = $('mob-chat-sub');
        if (ms) ms.textContent = sub;
        var mcb = $('mob-call-btns');
        if (mcb) mcb.style.display = isDm ? 'flex' : 'none';

        // Show chat view
        $('no-chat').style.display = 'none';
        $('chat-view').style.display = 'flex';
        $('messages').innerHTML = '';

        // Mobile slide to chat screen
        $('desk-layout').classList.add('chat-open');

        wsSend({ type: 'get-history', room: room });
        updBadges();

        // Focus input after transition
        setTimeout(function() { var mi = $('msg-input'); if (mi && window.innerWidth > 700) mi.focus(); }, 350);
    }

    function goBack() {
        $('desk-layout').classList.remove('chat-open');
    }

    function getPeer() {
        if (!S.room || !S.room.startsWith('dm:')) return null;
        var p = S.room.split(':');
        return p[1] === S.name ? p[2] : p[1];
    }

    // ═══ MESSAGES ═══
    function renderHist(room, msgs) {
        if (room !== S.room) return;
        var c = $('messages');
        c.innerHTML = '';
        if (!msgs || !msgs.length) { addSys('Начало чата'); return; }
        msgs.forEach(appendMsg);
        c.scrollTop = c.scrollHeight;
    }

    function onMsg(room, msg) {
        if (room === S.room) {
            appendMsg(msg);
            var c = $('messages');
            c.scrollTop = c.scrollHeight;
        } else {
            S.unread[room] = (S.unread[room] || 0) + 1;
            renderCh();
            renderDm();
            if (Notification && Notification.permission === 'granted')
                new Notification('MGV: ' + msg.from, { body: msg.text || '🎤' });
        }
    }

    function onDel(room, id) { var el = q('[data-mid="' + id + '"]'); if (el) el.remove(); }

    function onTyping(room, from) {
        if (room !== S.room || from === S.name) return;
        var ti = $('typing-indicator');
        if (ti) ti.textContent = from + ' печатает...';
        clearTimeout(S.typingMap[from]);
        S.typingMap[from] = setTimeout(function() { if (ti) ti.textContent = ''; }, 2000);
    }

    function appendMsg(m) {
        var c = $('messages'),
            own = m.from === S.name;
        var row = document.createElement('div');
        row.className = 'msg-row ' + (own ? 'own' : 'other');
        row.dataset.mid = m.id;
        var col = gc(m.from);
        var av = '<div class="msg-avatar" style="background:' + col + '22;color:' + col + '">' + ini(m.from) + '</div>';
        var del = '<button class="msg-del" onclick="MGV.delMsg(\'' + m.id + '\')">✕</button>';
        var body = '';
        if (!own) body += '<div class="msg-meta"><span class="msg-author">' + esc(m.from) + '</span></div>';

        if (m.msgType === 'voice' && m.file) {
            body += buildVoice(m, del);
        } else if (m.msgType === 'circle' && m.file) {
            body += buildCircle(m, del);
        } else if (m.file && isImg(m.file.mime)) {
            body += '<div class="msg-bubble">' + del + '<img class="msg-img" src="' + esc(m.file.url) + '" onclick="MGV.openImg(\'' + esc(m.file.url) + '\')" loading="lazy"></div>';
        } else if (m.file && isVid(m.file.mime)) {
            body += '<div class="msg-bubble">' + del + '<video class="msg-vid" src="' + esc(m.file.url) + '" controls playsinline preload="metadata"></video></div>';
        } else if (m.file) {
            body += '<div class="msg-bubble">' + del +
                '<a class="msg-file" href="' + esc(m.file.url) + '" target="_blank" download>' +
                '<span class="msg-file-icon">' + fIcon(m.file.mime) + '</span>' +
                '<div class="msg-file-info"><div class="msg-file-name">' + esc(m.file.name || '') + '</div>' +
                '<div class="msg-file-size">' + fmtS(m.file.size) + '</div></div></a>' +
                (m.text ? '<div style="margin-top:6px;font-size:13px">' + esc(m.text) + '</div>' : '') + '</div>';
        } else {
            body += '<div class="msg-bubble">' + del + esc(m.text || '').replace(/\n/g, '<br>') + '</div>';
        }
        body += '<div class="msg-time">' + fmtT(m.time) + '</div>';
        row.innerHTML = (own ? '' : av) + '<div class="msg-body">' + body + '</div>' + (own ? av : '');
        c.appendChild(row);
        if (m.msgType === 'voice') setTimeout(function() { drawWave('vc_' + m.id, m.file && m.file.peaks); }, 80);
    }

    // ─── Telegram-style voice pill ───
    function buildVoice(m, del) {
        var uid = 'vc_' + m.id,
            dur = +(m.file && m.file.duration) || 0;
        return '<div class="msg-bubble" style="padding:0;background:transparent;border:none">' +
            '<div class="voice-pill">' +
            '<button class="vp-btn" id="' + uid + '_b" onclick="MGV.vpPlay(\'' + esc(m.file.url) + '\',\'' + uid + '\')">▶</button>' +
            '<div class="vp-track" onclick="MGV.vpSeek(event,\'' + uid + '\')">' +
            '<canvas class="vp-canvas" id="' + uid + '_c"></canvas>' +
            '</div>' +
            '<span class="vp-dur" id="' + uid + '_d">' + fmtD(dur) + '</span>' +
            '</div>' + del + '</div>';
    }

    function drawWave(uid, peaks) {
        var cv = $(uid + '_c');
        if (!cv) return;
        var parent = cv.parentElement;
        var W = parent ? parent.offsetWidth : 160;
        if (W < 20) W = 160;
        var H = 34;
        cv.width = W;
        cv.height = H;
        cv._peaks = peaks;
        renderWaveFrame(cv, 0, peaks);
    }

    function renderWaveFrame(cv, pct, peaks) {
        if (!cv) return;
        var W = cv.width,
            H = cv.height;
        if (!W || !H) return;
        var ctx = cv.getContext('2d');
        ctx.clearRect(0, 0, W, H);
        var n = 40,
            gap = 1,
            bw = Math.max(2, (W - n * gap) / n);
        for (var i = 0; i < n; i++) {
            var h;
            var pk = peaks || cv._peaks;
            if (pk && pk.length) h = pk[Math.floor(i * pk.length / n)] * H;
            else h = (Math.sin(i * 0.78 + 1.2) * 0.3 + 0.56) * H;
            h = Math.max(3, h);
            var done = (i / n) < pct;
            ctx.fillStyle = done ? '#3b82f6' : 'rgba(148,163,184,0.35)';
            ctx.beginPath();
            ctx.roundRect(i * (bw + gap), (H - h) / 2, bw, h, 1.5);
            ctx.fill();
        }
    }

    // ─── Voice playback ───
    function vpPlay(url, uid) {
        var btn = $(uid + '_b'),
            dur = $(uid + '_d'),
            cv = $(uid + '_c');

        // Stop current
        if (VP.el && !VP.el.paused) {
            VP.el.pause();
            var ob = $(VP.uid + '_b');
            if (ob) ob.textContent = '▶';
            if (VP.uid === uid) { VP.el = null;
                VP.uid = null; return; }
        }

        var a = new Audio(url);
        VP.el = a;
        VP.uid = uid;
        if (btn) btn.textContent = '⏸';

        a.addEventListener('timeupdate', function() {
            if (dur) dur.textContent = fmtD(a.currentTime);
            if (a.duration) renderWaveFrame(cv, a.currentTime / a.duration);
        });
        a.addEventListener('ended', function() {
            if (btn) btn.textContent = '▶';
            if (dur && a.duration) dur.textContent = fmtD(a.duration);
            renderWaveFrame(cv, 0);
            VP.el = null;
            VP.uid = null;
        });
        a.addEventListener('error', function() { if (btn) btn.textContent = '▶';
            VP.el = null;
            VP.uid = null; });
        a.play().catch(function() { if (btn) btn.textContent = '▶'; });
    }

    function vpSeek(e, uid) {
        if (!VP.el || VP.uid !== uid) return;
        var rect = e.currentTarget.getBoundingClientRect();
        var pct = (e.clientX - rect.left) / rect.width;
        if (VP.el.duration) VP.el.currentTime = VP.el.duration * pct;
    }

    // ─── Circle ───
    function buildCircle(m, del) {
        var cid = 'ci_' + m.id;
        return '<div class="circle-wrap" id="' + cid + '" onclick="MGV.circPlay(\'' + cid + '\')">' +
            '<video class="circle-vid" src="' + esc(m.file.url) + '" loop playsinline preload="metadata"></video>' +
            '<div class="circle-ov">▶</div>' +
            '<span class="circle-dur">' + fmtD(m.file && m.file.duration) + '</span>' +
            del + '</div>';
    }

    function circPlay(wid) {
        var w = $(wid);
        if (!w) return;
        var v = w.querySelector('video'),
            ov = w.querySelector('.circle-ov');
        if (!v) return;
        if (v.paused) { v.play().catch(function() {}); if (ov) ov.style.opacity = '0';
            v.onended = function() { if (ov) ov.style.opacity = '1'; }; } else { v.pause();
            v.currentTime = 0; if (ov) ov.style.opacity = '1'; }
    }

    function addSys(t) {
        var c = $('messages'),
            r = document.createElement('div');
        r.className = 'msg-row sys';
        r.innerHTML = '<div class="msg-bubble">' + esc(t) + '</div>';
        c.appendChild(r);
    }

    function fIcon(m) {
        if (!m) return '📄';
        if (m.startsWith('image/')) return '🖼️';
        if (m.startsWith('video/')) return '🎬';
        if (m.startsWith('audio/')) return '🎵';
        if (m.includes('pdf')) return '📕';
        if (m.includes('zip') || m.includes('rar')) return '🗜️';
        return '📄';
    }

    // ═══ SEND ═══
    function sendMsg() {
        var inp = $('msg-input'),
            txt = inp.value.trim();
        if (!S.room) return;
        if (S.pendingFile) { dispatch({ file: S.pendingFile, text: txt });
            clearFile();
            inp.value = '';
            updBtns(); return; }
        if (!txt) return;
        inp.value = '';
        updBtns();
        dispatch({ text: txt });
    }

    function dispatch(d) {
        var p = { text: d.text || '', file: d.file || null, msgType: d.msgType || null };
        if (S.rType === 'dm') wsSend(Object.assign({ type: 'dm', to: getPeer() }, p));
        else wsSend(Object.assign({ type: 'channel-msg', room: S.room }, p));
    }

    function onInput() {
        updBtns();
        clearTimeout(S.typingT);
        if ($('msg-input').value.trim()) S.typingT = setTimeout(function() { wsSend({ type: 'typing', room: S.room }); }, 300);
        var i = $('msg-input');
        i.style.height = 'auto';
        i.style.height = Math.min(i.scrollHeight, 120) + 'px';
    }

    function updBtns() {
        var has = !!($('msg-input').value.trim().length) || !!S.pendingFile;
        $('btn-voice').style.display = has ? 'none' : 'flex';
        $('btn-circle').style.display = has ? 'none' : 'flex';
        $('send-btn').style.display = has ? 'flex' : 'none';
    }

    function delMsg(id) { if (!confirm('Удалить?')) return;
        wsSend({ type: 'delete-msg', room: S.room, msgId: id }); }

    // ═══ FILE UPLOAD ═══
    function handleFile(e) { var f = e.target.files[0]; if (!f) return;
        upload(f);
        e.target.value = ''; }

    function upload(file, msgType, meta) {
        if (file.size > 100 * 1024 * 1024) { alert('Макс 100MB'); return; }
        if (!msgType) { $('upload-preview-name').textContent = file.name + ' (' + fmtS(file.size) + ')';
            $('upload-preview').style.display = 'flex'; }
        var fd = new FormData();
        fd.append('file', file);
        if (meta) fd.append('meta', JSON.stringify(meta));
        fetch('/upload?user=' + encodeURIComponent(S.name), { method: 'POST', body: fd })
            .then(function(r) { return r.json(); })
            .then(function(data) {
                if (data.error) { alert('Ошибка: ' + data.error);
                    clearFile(); return; }
                if (meta && meta.duration != null) data.duration = meta.duration;
                if (meta && meta.peaks) data.peaks = meta.peaks;
                if (msgType) { $('upload-preview').style.display = 'none';
                    dispatch({ msgType: msgType, file: data }); } else { S.pendingFile = data;
                    updBtns(); }
            })
            .catch(function() { alert('Ошибка загрузки');
                clearFile(); });
    }

    function clearFile() { S.pendingFile = null;
        $('upload-preview').style.display = 'none';
        updBtns(); }

    // ═══ VOICE RECORDING ═══
    async function startVoice() {
        if (!S.room) return;
        try { VR.stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch (e) { alert('Нет микрофона: ' + e.message); return; }
        var AC = window.AudioContext || window.webkitAudioContext;
        VR.actx = new AC();
        var src = VR.actx.createMediaStreamSource(VR.stream);
        VR.an = VR.actx.createAnalyser();
        VR.an.fftSize = 256;
        src.connect(VR.an);
        VR.peaks = [];
        var mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/ogg', ''].find(function(m) { return !m || MediaRecorder.isTypeSupported(m); });
        VR.mr = new MediaRecorder(VR.stream, mime ? { mimeType: mime } : {});
        VR.chunks = [];
        VR.mr.ondataavailable = function(e) { if (e.data && e.data.size > 0) VR.chunks.push(e.data); };
        VR.mr.onstop = vrDone;
        VR.mr.start(100);
        VR.secs = 0;
        $('rec-time').textContent = '0:00';
        $('voice-recorder').classList.add('active');
        VR.timer = setInterval(function() { VR.secs++;
            $('rec-time').textContent = fmtD(VR.secs); if (VR.secs >= 300) stopVoice(); }, 1000);
        vrDraw();
    }

    function vrDraw() {
        var cv = $('rec-wave');
        if (!cv || !VR.an) return;
        var W = cv.offsetWidth || 180,
            H = 26;
        cv.width = W;
        cv.height = H;
        var ctx = cv.getContext('2d');
        var d = new Uint8Array(VR.an.frequencyBinCount);
        VR.an.getByteFrequencyData(d);
        var avg = 0;
        for (var i = 0; i < d.length; i++) avg += d[i];
        VR.peaks.push(avg / d.length / 255);
        ctx.clearRect(0, 0, W, H);
        var bars = Math.floor(W / 5);
        for (var i = 0; i < bars; i++) {
            var v = Math.max(2, (d[Math.floor(i * d.length / bars)] / 255) * H);
            ctx.fillStyle = d[Math.floor(i * d.length / bars)] > 40 ? '#3b82f6' : 'rgba(148,163,184,.25)';
            ctx.fillRect(i * 5, (H - v) / 2, 3, v);
        }
        VR.raf = requestAnimationFrame(vrDraw);
    }

    function stopVoice() { if (VR.mr && VR.mr.state !== 'inactive') VR.mr.stop(); }

    function cancelVoice() { if (VR.mr && VR.mr.state !== 'inactive') { VR.mr.onstop = null;
            VR.mr.stop(); }
        vrClean(); }

    function vrDone() {
        var dur = VR.secs,
            peaks = normP(VR.peaks, 40);
        var mime = (VR.chunks[0] && VR.chunks[0].type) || 'audio/webm';
        var blob = new Blob(VR.chunks, { type: mime });
        var f = new File([blob], 'v_' + Date.now() + (mime.includes('ogg') ? '.ogg' : '.webm'), { type: mime });
        vrClean();
        upload(f, 'voice', { duration: dur, peaks: peaks });
    }

    function vrClean() {
        clearInterval(VR.timer);
        cancelAnimationFrame(VR.raf);
        if (VR.actx) { try { VR.actx.close(); } catch (e) {} }
        if (VR.stream) VR.stream.getTracks().forEach(function(t) { t.stop(); });
        VR.stream = null;
        VR.an = null;
        VR.actx = null;
        $('voice-recorder').classList.remove('active');
    }

    function normP(arr, n) { var r = []; for (var i = 0; i < n; i++) { var x = Math.floor(i * arr.length / n);
            r.push(Math.max(.04, Math.min(1, arr[x] || 0))); } return r; }

    // ═══ CIRCLE RECORDING ═══
    async function startCircle() {
        if (!S.room) return;
        try { CR.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 480 }, height: { ideal: 480 } }, audio: true }); } catch (e) { alert('Нет камеры: ' + e.message); return; }
        $('cr-vid').srcObject = CR.stream;
        $('cr-vid').play().catch(function() {});
        $('circle-recorder').classList.add('active');
        var mime = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', ''].find(function(m) { return !m || MediaRecorder.isTypeSupported(m); });
        CR.mr = new MediaRecorder(CR.stream, mime ? { mimeType: mime, videoBitsPerSecond: 600000 } : {});
        CR.chunks = [];
        CR.mr.ondataavailable = function(e) { if (e.data && e.data.size > 0) CR.chunks.push(e.data); };
        CR.mr.onstop = crDone;
        CR.mr.start(100);
        CR.secs = 0;
        $('cr-time').textContent = '0:00';
        crRing(0);
        CR.timer = setInterval(function() { CR.secs++;
            $('cr-time').textContent = fmtD(CR.secs);
            crRing(CR.secs / 60); if (CR.secs >= 60) stopCircle(); }, 1000);
    }

    function crRing(f) { var el = $('cr-prog'); if (el) el.style.strokeDashoffset = 754 * (1 - f); }

    function stopCircle() { if (CR.mr && CR.mr.state !== 'inactive') CR.mr.stop(); }

    function cancelCircle() { if (CR.mr && CR.mr.state !== 'inactive') { CR.mr.onstop = null;
            CR.mr.stop(); }
        crClean(); }

    function crDone() {
        var dur = CR.secs,
            blob = new Blob(CR.chunks, { type: 'video/webm' });
        var f = new File([blob], 'c_' + Date.now() + '.webm', { type: 'video/webm' });
        crClean();
        upload(f, 'circle', { duration: dur });
    }

    function crClean() {
        clearInterval(CR.timer);
        if (CR.stream) CR.stream.getTracks().forEach(function(t) { t.stop(); });
        CR.stream = null;
        $('circle-recorder').classList.remove('active');
        var v = $('cr-vid');
        if (v) v.srcObject = null;
    }

    // ═══ LIGHTBOX ═══
    function openImg(url) { $('lbox-img').src = url;
        $('lbox').classList.add('active'); }

    // ═══ CHANNELS MODAL ═══
    function openCreateChannel() { if (S.role !== 'admin') return;
        $('create-channel-modal').classList.add('active'); }

    function closeCreateChannel() { $('create-channel-modal').classList.remove('active'); }

    function submitCreateChannel() {
        var nm = $('new-ch-name').value.trim(),
            ds = $('new-ch-desc').value.trim();
        if (!nm) return;
        wsSend({ type: 'create-channel', name: nm, description: ds, channelType: 'public' });
        closeCreateChannel();
        $('new-ch-name').value = '';
        $('new-ch-desc').value = '';
    }

    // ═══ WebRTC ═══
    async function getIce() {
        if (iceCache) return iceCache;
        try { var r = await fetch(TURN);
            iceCache = await r.json(); return iceCache; } catch (e) { return [{ urls: 'stun:stun.l.google.com:19302' }]; }
    }

    async function makePc(remote) {
        if (RTC.pc) { try { RTC.pc.close(); } catch (e) {}
            RTC.pc = null; }
        RTC.sdpSet = false;
        RTC.iceQ = [];
        var ice = await getIce();
        RTC.pc = new RTCPeerConnection({ iceServers: ice, bundlePolicy: 'max-bundle' });
        RTC.local.getTracks().forEach(function(t) { RTC.pc.addTrack(t, RTC.local); });
        RTC.pc.onicecandidate = function(e) { if (e.candidate) wsSend({ type: 'ice', to: remote, candidate: e.candidate }); };
        RTC.pc.ontrack = function(e) {
            var tk = e.track;
            if (tk.kind === 'audio') {
                var a = $('remote-audio');
                if (!a.srcObject) a.srcObject = new MediaStream();
                a.srcObject.addTrack(tk);
                a.play().catch(function() {});
            } else {
                var v = $('remote-vid');
                if (!v.srcObject) v.srcObject = new MediaStream();
                v.srcObject.addTrack(tk);
                v.style.display = 'block';
                $('call-bg').style.display = 'none';
                $('call-topbar').style.display = 'flex';
                v.play().catch(function() {});
            }
        };

        function onConn(s) {
            if (s === 'connected' || s === 'completed') { setCallSt('СОЕДИНЕНО'); if (!RTC.timer) startTimer(); }
            if (s === 'failed') { addSys('Связь потеряна');
                rtcClean(); }
        }
        RTC.pc.onconnectionstatechange = function() { onConn(RTC.pc.connectionState); };
        RTC.pc.oniceconnectionstatechange = function() { onConn(RTC.pc.iceConnectionState); };
    }

    async function flushIce() {
        while (RTC.iceQ.length) { try { await RTC.pc.addIceCandidate(new RTCIceCandidate(RTC.iceQ.shift())); } catch (e) {} }
    }

    async function startCall(type) {
        var peer = S.peer;
        if (!peer) return;
        RTC.withVid = (type === 'video');
        try { RTC.local = await navigator.mediaDevices.getUserMedia({ audio: true, video: RTC.withVid ? { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' } : false }); } catch (e) {
            if (RTC.withVid) { try { RTC.local = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch (e2) { alert('Нет доступа'); return; }
                RTC.withVid = false; } else { alert('Нет микрофона'); return; }
        }
        showCallOv(peer);
        setCallSt('ПОДГОТОВКА...');
        if (RTC.withVid) { $('call-pip-vid').srcObject = RTC.local;
            $('call-pip').style.display = 'block'; }
        await makePc(peer);
        var off = await RTC.pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
        await RTC.pc.setLocalDescription(off);
        wsSend({ type: 'call-offer', to: peer, offer: RTC.pc.localDescription, fromName: S.name, withVideo: RTC.withVid });
        setCallSt('ЖДЁМ ОТВЕТА...');
    }

    function rtcOffer(m) {
        RTC.incOffer = m.offer;
        RTC.incFrom = m.fromName || m.from;
        RTC.incVid = !!m.withVideo;
        $('inc-name').textContent = RTC.incFrom;
        $('inc-label').textContent = RTC.incVid ? '📹 Видеозвонок' : '📞 Голосовой';
        var av = $('ans-vid-btn');
        if (av) av.style.display = RTC.incVid ? '' : 'none';
        $('incoming').classList.add('active');
        try {
            var ac = new(window.AudioContext || window.webkitAudioContext)(),
                osc = ac.createOscillator(),
                g = ac.createGain();
            osc.frequency.value = 480;
            g.gain.value = .06;
            osc.connect(g);
            g.connect(ac.destination);
            osc.start();
            setTimeout(function() { try { osc.stop();
                    ac.close(); } catch (e) {} }, 800);
        } catch (e) {}
    }

    async function answerCall(withVid) {
        $('incoming').classList.remove('active');
        RTC.withVid = !!withVid && RTC.incVid;
        try { RTC.local = await navigator.mediaDevices.getUserMedia({ audio: true, video: RTC.withVid ? { width: { ideal: 640 }, height: { ideal: 480 } } : false }); } catch (e) { try { RTC.local = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch (e2) { alert('Нет доступа'); return; }
            RTC.withVid = false; }
        if (RTC.withVid) { $('call-pip-vid').srcObject = RTC.local;
            $('call-pip').style.display = 'block'; }
        showCallOv(RTC.incFrom);
        setCallSt('СОЕДИНЯЕМСЯ...');
        await makePc(RTC.incFrom);
        await RTC.pc.setRemoteDescription(new RTCSessionDescription(RTC.incOffer));
        RTC.sdpSet = true;
        await flushIce();
        var ans = await RTC.pc.createAnswer();
        await RTC.pc.setLocalDescription(ans);
        wsSend({ type: 'call-answer', to: RTC.incFrom, answer: RTC.pc.localDescription, withVideo: RTC.withVid });
    }

    function declineCall() {
        $('incoming').classList.remove('active');
        wsSend({ type: 'call-decline', to: RTC.incFrom });
        RTC.incOffer = null;
        RTC.incFrom = null;
    }

    async function rtcAnswer(m) {
        if (!RTC.pc) return;
        await RTC.pc.setRemoteDescription(new RTCSessionDescription(m.answer));
        RTC.sdpSet = true;
        await flushIce();
    }

    async function rtcIce(m) {
        if (!RTC.pc || !m.candidate) return;
        if (RTC.sdpSet) { try { await RTC.pc.addIceCandidate(new RTCIceCandidate(m.candidate)); } catch (e) {} } else RTC.iceQ.push(m.candidate);
    }

    function endCall() { var p = S.peer || RTC.incFrom; if (p) wsSend({ type: 'call-end', to: p });
        rtcClean(); }

    function rtcRemEnd() { addSys('Звонок завершён');
        rtcClean(); }

    function rtcDecline() { setCallSt('ОТКЛОНЕНО');
        setTimeout(rtcClean, 1400); }

    function rtcClean() {
        if (RTC.pc) { try { RTC.pc.close(); } catch (e) {}
            RTC.pc = null; }
        if (RTC.local) { RTC.local.getTracks().forEach(function(t) { t.stop(); });
            RTC.local = null; }
        $('call-overlay').classList.remove('active');
        var rv = $('remote-vid');
        if (rv) { try { rv.srcObject = null; } catch (e) {}
            rv.style.display = 'none'; }
        $('call-pip').style.display = 'none';
        try { $('call-pip-vid').srcObject = null; } catch (e) {}
        var ra = $('remote-audio');
        if (ra) { try { ra.srcObject = null; } catch (e) {} }
        $('call-bg').style.display = 'flex';
        $('call-topbar').style.display = 'none';
        if (RTC.timer) { clearInterval(RTC.timer);
            RTC.timer = null; }
        $('call-tmr').textContent = '';
        $('call-tb-tmr').textContent = '';
        RTC.sdpSet = false;
        RTC.iceQ = [];
        RTC.withVid = false;
        RTC.muted = false;
        RTC.vidOff = false;
        $('cbtn-mic').textContent = '🎤';
        $('cbtn-mic').classList.remove('off');
        $('cbtn-cam').textContent = '📹';
        $('cbtn-cam').classList.remove('off');
    }

    function toggleMute() {
        if (!RTC.local) return;
        RTC.muted = !RTC.muted;
        RTC.local.getAudioTracks().forEach(function(t) { t.enabled = !RTC.muted; });
        $('cbtn-mic').textContent = RTC.muted ? '🔇' : '🎤';
        $('cbtn-mic').classList.toggle('off', RTC.muted);
    }

    function toggleVideo() {
        if (!RTC.local) return;
        RTC.vidOff = !RTC.vidOff;
        RTC.local.getVideoTracks().forEach(function(t) { t.enabled = !RTC.vidOff; });
        $('cbtn-cam').textContent = RTC.vidOff ? '🚫' : '📹';
        $('cbtn-cam').classList.toggle('off', RTC.vidOff);
        $('call-pip').style.display = RTC.vidOff ? 'none' : 'block';
    }

    function showCallOv(peer) {
        var col = gc(peer),
            av = $('call-av');
        av.textContent = ini(peer);
        av.style.background = col + '22';
        av.style.color = col;
        $('call-name').textContent = peer;
        $('call-tb-name').textContent = peer;
        $('call-overlay').classList.add('active');
        $('call-bg').style.display = 'flex';
        $('call-topbar').style.display = 'none';
    }

    function setCallSt(t) { var el = $('call-st'); if (el) el.textContent = t; }

    function startTimer() {
        RTC.t0 = Date.now();
        RTC.timer = setInterval(function() {
            var s = Math.floor((Date.now() - RTC.t0) / 1000),
                v = fmtD(s);
            $('call-tmr').textContent = v;
            $('call-tb-tmr').textContent = v;
        }, 1000);
    }

    // ═══ INIT ═══
    function init() {
        $('l-name').addEventListener('keydown', function(e) { if (e.key === 'Enter') $('l-pass').focus(); });
        $('l-pass').addEventListener('keydown', function(e) { if (e.key === 'Enter') doLogin(); });
        $('login-btn').addEventListener('click', doLogin);
        $('msg-input').addEventListener('keydown', function(e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault();
                sendMsg(); } });
        $('msg-input').addEventListener('input', onInput);
        $('file-input').addEventListener('change', handleFile);
        $('upload-cancel-btn').addEventListener('click', clearFile);
        $('rec-cancel').addEventListener('click', cancelVoice);
        $('rec-send').addEventListener('click', stopVoice);
        var cv = $('chat-view');
        if (cv) { cv.addEventListener('dragover', function(e) { e.preventDefault(); });
            cv.addEventListener('drop', function(e) { e.preventDefault(); var f = e.dataTransfer.files[0]; if (f) upload(f); }); }
        if (Notification && Notification.permission !== 'granted') Notification.requestPermission();
        if ($('admin-link')) $('admin-link').style.display = 'none';
        var n = localStorage.getItem('mgv_n'),
            p = localStorage.getItem('mgv_p');
        if (n && p) { S.name = n;
            S.pass = p;
            connect(); }
    }

    document.addEventListener('DOMContentLoaded', init);

    window.MGV = {
        doLogin,
        doLogout,
        sendMsg,
        delMsg,
        openImg,
        startVoice,
        stopVoice,
        cancelVoice,
        vpPlay,
        vpSeek,
        startCircle,
        stopCircle,
        cancelCircle,
        circPlay,
        startCall,
        endCall,
        answerCall,
        declineCall,
        toggleMute,
        toggleVideo,
        openCreateChannel,
        closeCreateChannel,
        submitCreateChannel,
        clearFile,
        openRoom,
        switchTab,
        goBack,
        attachFile: function() { $('file-input').click(); }
    };

})();
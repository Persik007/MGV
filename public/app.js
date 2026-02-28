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
        tab: 'ch',
        friends: [],
        incoming: [],
        outgoing: []
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
        isCallerSide: false,
        iceQ: [],
        sdpSet: false
    };

    var VR = { mr: null, stream: null, chunks: [], timer: null, secs: 0, actx: null, an: null, raf: null, peaks: [] };
    var CR = { mr: null, stream: null, chunks: [], timer: null, secs: 0 };
    var VP = { el: null, uid: null };

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
            case 'reaction-update':
                onReactionUpdate(m);
                break;
            case 'friends-data':
                onFriendsData(m);
                break;
            case 'friend-result':
                onFriendResult(m);
                break;
            case 'friend-incoming':
                onFriendIncoming(m);
                break;
            case 'friend-accepted':
                onFriendAccepted(m);
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
        // Register SW + request push permission
        initPwa(S.name);
    }

    // ═══ TABS ═══
    function switchTab(t) {
        S.tab = t;
        $('tab-ch').classList.toggle('on', t === 'ch');
        $('tab-dm').classList.toggle('on', t === 'dm');
        $('tab-fr').classList.toggle('on', t === 'fr');
        $('panel-ch').style.display = t === 'ch' ? '' : 'none';
        $('panel-dm').style.display = t === 'dm' ? '' : 'none';
        var pfr = $('panel-fr');
        if (pfr) pfr.style.display = t === 'fr' ? '' : 'none';
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
        // Show friends list always + online indicator
        var shown = new Set();
        // Friends first (always visible)
        S.friends.forEach(function(nm) {
            if (nm === S.name) return;
            shown.add(nm);
            var col = gc(nm),
                dr = dmKey(nm),
                u = S.unread[dr] || 0;
            var isOnline = S.online.includes(nm);
            var d = document.createElement('div');
            d.className = 'u-row';
            d.innerHTML = '<div class="u-av" style="background:' + col + '22;color:' + col + '">' +
                '<span>' + ini(nm) + '</span>' +
                (isOnline ? '<span class="u-av-online"></span>' : '') +
                '</div>' +
                '<div class="u-info"><span class="u-name">' + esc(nm) + '</span>' +
                (isOnline ? '<span class="u-status-online">онлайн</span>' : '<span class="u-status-off">не в сети</span>') +
                '</div>' +
                (u ? '<span class="u-badge">' + u + '</span>' : '');
            d.addEventListener('click', function() { openRoom(dr, 'dm', nm); });
            box.appendChild(d);
        });
        // Online non-friends (grayed out, still accessible)
        S.online.filter(function(n) { return n !== S.name && !shown.has(n); }).forEach(function(nm) {
            var col = gc(nm),
                dr = dmKey(nm),
                u = S.unread[dr] || 0;
            var d = document.createElement('div');
            d.className = 'u-row u-stranger';
            d.innerHTML = '<div class="u-av" style="background:' + col + '22;color:' + col + '">' + ini(nm) + '</div>' +
                '<div class="u-info"><span class="u-name">' + esc(nm) + '</span>' +
                '<span class="u-status-online">онлайн</span></div>' +
                (u ? '<span class="u-badge">' + u + '</span>' : '');
            d.addEventListener('click', function() { openRoom(dr, 'dm', nm); });
            box.appendChild(d);
        });
        if (box.children.length === 0) {
            var empty = document.createElement('div');
            empty.className = 'fr-empty';
            empty.textContent = 'Нет друзей — добавь во вкладке Друзья';
            box.appendChild(empty);
        }
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
        var bfr = $('badge-fr');
        var frc = S.incoming ? S.incoming.length : 0;
        if (bfr) { bfr.textContent = frc;
            bfr.style.display = frc ? '' : 'none'; }
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
        row.addEventListener('mousedown', function(e) { msgLongPressStart(e, m.id); });
        row.addEventListener('touchstart', function(e) { msgLongPressStart(e, m.id); }, { passive: true });
        row.addEventListener('mouseup', msgLongPressEnd);
        row.addEventListener('touchend', msgLongPressEnd);
        row.addEventListener('mouseleave', msgLongPressEnd);

        var col = gc(m.from);
        var av = '<div class="msg-avatar" style="background:' + col + '22;color:' + col + '">' + ini(m.from) + '</div>';
        var del = '<button class="msg-del" onclick="MGV.delMsg(\'' + m.id + '\')">✕</button>';
        var react = '<button class="msg-react-btn" onclick="event.stopPropagation();window._mgvPicker(\'' + m.id + '\',this)" title="Реакция">😊</button>';
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

        // Reactions (from history)
        var rb = '<div class="reactions-bar">';
        if (m.reactions) {
            Object.keys(m.reactions).forEach(function(em) {
                var us = m.reactions[em];
                if (!us || !us.length) return;
                var mine = us.indexOf(S.name) !== -1;
                rb += '<button class="reaction-chip' + (mine ? ' mine' : '') + '" title="' + esc(us.join(', ')) + '" onclick="event.stopPropagation();window._mgvReact(\'' + m.id + '\',\'' + em + '\')"><span class="rc-em">' + em + '</span><span class="rc-n">' + us.length + '</span></button>';
            });
        }
        rb += '</div>';
        body += rb;

        // React btn goes between avatar and body, outside msg-body
        if (own) {
            row.innerHTML = '<div class="msg-body">' + body + '</div>' + react + av;
        } else {
            row.innerHTML = av + react + '<div class="msg-body">' + body + '</div>';
        }
        c.appendChild(row);
        if (m.msgType === 'voice') setTimeout(function() { drawWave('vc_' + m.id, m.file && m.file.peaks); }, 80);
    }
    // ─── Telegram-style voice pill (с аватаром) ───
    function buildVoice(m, del) {
        var uid = 'vc_' + m.id;
        var dur = +(m.file && m.file.duration) || 0;
        var col = gc(m.from);
        var avLetter = ini(m.from);
        // Аватар — кружок с буквой + анимация при воспроизведении
        return '<div class="voice-pill" id="' + uid + '_pill">' +
            '<div class="vp-avatar" id="' + uid + '_av"' +
            ' style="background:' + col + '22;color:' + col + '"' +
            ' onclick="MGV.vpPlay(\'' + esc(m.file.url) + '\',\'' + uid + '\')">' +
            '<span class="vp-av-letter" id="' + uid + '_al">' + avLetter + '</span>' +
            '<span class="vp-av-icon"   id="' + uid + '_ic">▶</span>' +
            '</div>' +
            '<div class="vp-content">' +
            '<div class="vp-track" onclick="MGV.vpSeek(event,\'' + uid + '\')">' +
            '<canvas class="vp-canvas" id="' + uid + '_c"></canvas>' +
            '</div>' +
            '<span class="vp-dur" id="' + uid + '_d">' + fmtD(dur) + '</span>' +
            '</div>' +
            del + '</div>';
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
    function vpSetState(uid, playing) {
        var pill = $(uid + '_pill');
        var ic = $(uid + '_ic');
        var al = $(uid + '_al');
        if (pill) pill.classList.toggle('playing', playing);
        if (ic) ic.textContent = playing ? '⏸' : '▶';
        if (al) al.style.opacity = playing ? '0' : '1';
    }

    function vpPlay(url, uid) {
        var dur = $(uid + '_d');
        var cv = $(uid + '_c');

        // Stop previous
        if (VP.el && !VP.el.paused) {
            VP.el.pause();
            vpSetState(VP.uid, false);
            var prevDur = $(VP.uid + '_d');
            if (prevDur && VP.el.duration) prevDur.textContent = fmtD(VP.el.duration);
            renderWaveFrame($(VP.uid + '_c'), 0);
            if (VP.uid === uid) { VP.el = null;
                VP.uid = null; return; }
        }

        var a = new Audio(url);
        VP.el = a;
        VP.uid = uid;
        vpSetState(uid, true);

        a.addEventListener('timeupdate', function() {
            if (dur) dur.textContent = fmtD(a.currentTime);
            if (a.duration) renderWaveFrame(cv, a.currentTime / a.duration);
        });
        a.addEventListener('ended', function() {
            vpSetState(uid, false);
            if (dur && a.duration) dur.textContent = fmtD(a.duration);
            renderWaveFrame(cv, 0);
            VP.el = null;
            VP.uid = null;
        });
        a.addEventListener('error', function() {
            vpSetState(uid, false);
            VP.el = null;
            VP.uid = null;
        });
        a.play().catch(function() { vpSetState(uid, false); });
    }

    function vpSeek(e, uid) {
        if (!VP.el || VP.uid !== uid) return;
        var rect = e.currentTarget.getBoundingClientRect();
        var pct = (e.clientX - rect.left) / rect.width;
        if (VP.el.duration) VP.el.currentTime = VP.el.duration * pct;
    }

    // ─── Circle (Telegram-style кружок с кольцом) ───
    function buildCircle(m, del) {
        var cid = 'ci_' + m.id;
        var dur = +(m.file && m.file.duration) || 0;
        var r = 94,
            circ = Math.round(2 * Math.PI * r);
        return '<div class="circle-wrap" id="' + cid + '">' +
            '<svg class="circle-ring-svg" viewBox="0 0 200 200">' +
            '<circle class="cr-track" cx="100" cy="100" r="' + r + '"/>' +
            '<circle class="cr-prog" id="' + cid + '_ring" cx="100" cy="100" r="' + r + '"' +
            ' stroke-dasharray="' + circ + '" stroke-dashoffset="' + circ + '"/>' +
            '</svg>' +
            '<video class="circle-vid" id="' + cid + '_v" src="' + esc(m.file.url) + '" playsinline preload="metadata"></video>' +
            '<div class="circle-ov" id="' + cid + '_ov" onclick="MGV.circPlay(\'' + cid + '\')">' +
            '<div class="circle-play-icon">&#9654;</div>' +
            '</div>' +
            '<span class="circle-dur" id="' + cid + '_dur">' + fmtD(dur) + '</span>' +
            del + '</div>';
    }

    function circPlay(cid) {
        var w = $(cid);
        if (!w) return;
        var v = $(cid + '_v'),
            ov = $(cid + '_ov'),
            ring = $(cid + '_ring'),
            durEl = $(cid + '_dur');
        if (!v) return;
        if (v.paused) {
            document.querySelectorAll('.circle-wrap video').forEach(function(vid) {
                if (vid !== v && !vid.paused) {
                    vid.pause();
                    vid.currentTime = 0;
                    var pid = vid.id.replace('_v', '');
                    var oov = $(pid + '_ov'),
                        oring = $(pid + '_ring'),
                        odur = $(pid + '_dur');
                    if (oov) oov.style.opacity = '1';
                    if (oring) oring.style.strokeDashoffset = oring.getAttribute('stroke-dasharray');
                    if (odur && vid.duration) odur.textContent = fmtD(vid.duration);
                }
            });
            v.play().catch(function() {});
            if (ov) ov.style.opacity = '0';
            var circ = +(ring && ring.getAttribute('stroke-dasharray')) || 591;
            v.ontimeupdate = function() {
                if (!v.duration) return;
                var pct = v.currentTime / v.duration;
                if (ring) ring.style.strokeDashoffset = circ * (1 - pct);
                if (durEl) durEl.textContent = fmtD(v.currentTime);
            };
            v.onended = function() {
                if (ov) ov.style.opacity = '1';
                if (ring) ring.style.strokeDashoffset = circ;
                if (durEl) durEl.textContent = fmtD(v.duration || 0);
                v.currentTime = 0;
            };
        } else {
            v.pause();
            v.currentTime = 0;
            if (ov) ov.style.opacity = '1';
            var circ2 = +(ring && ring.getAttribute('stroke-dasharray')) || 591;
            if (ring) ring.style.strokeDashoffset = circ2;
            if (durEl) durEl.textContent = fmtD(v.duration || 0);
        }
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



    // ════════════════════════════════════════════════
    // WebRTC — ЗВОНКИ
    // ════════════════════════════════════════════════

    // ICE серверы загружаем с сервера (/api/ice) — там могут быть TURN из env Railway
    var ICE_CACHE = null;
    async function getIceServers() {
        if (ICE_CACHE) return ICE_CACHE;
        try {
            var r = await fetch('/api/ice');
            ICE_CACHE = await r.json();
            console.log('[ICE] Загружено серверов:', ICE_CACHE.length);
            return ICE_CACHE;
        } catch (e) {
            console.warn('[ICE] Не удалось загрузить, используем fallback STUN');
            return [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ];
        }
    }

    // Лог в UI (строка статуса звонка) + консоль
    function callLog(msg) {
        console.log('[RTC]', msg);
        var el = $('call-st');
        if (el) el.textContent = msg.length > 50 ? msg.slice(0, 50) + '…' : msg;
    }

    // ── Получить медиа ──
    async function getMedia(wantVideo) {
        var audio = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
        var video = wantVideo ?
            { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' } :
            false;
        try {
            return await navigator.mediaDevices.getUserMedia({ audio: audio, video: video });
        } catch (e) {
            if (wantVideo) {
                try { return await navigator.mediaDevices.getUserMedia({ audio: audio }); } catch (e2) { throw new Error('Нет микрофона: ' + e2.message); }
            }
            throw new Error('Нет микрофона: ' + e.message);
        }
    }

    // ── Создать PeerConnection ──
    function buildPc(remoteName, iceServers) {
        if (RTC.pc) { try { RTC.pc.close(); } catch (e) {}
            RTC.pc = null; }
        RTC.sdpSet = false;
        RTC.iceQ = [];

        var pc = new RTCPeerConnection({ iceServers: iceServers, iceCandidatePoolSize: 6 });
        RTC.pc = pc;

        // Добавляем локальные треки
        RTC.local.getTracks().forEach(function(t) { pc.addTrack(t, RTC.local); });

        // Отправляем ICE кандидатов собеседнику через WS
        pc.onicecandidate = function(ev) {
            if (ev.candidate) {
                wsSend({ type: 'ice', to: remoteName, candidate: ev.candidate });
            } else {
                callLog('ICE сбор завершён');
            }
        };

        pc.onicegatheringstatechange = function() {
            callLog('ICE сбор: ' + pc.iceGatheringState);
        };

        // Входящие треки от собеседника
        pc.ontrack = function(ev) {
            callLog('Трек: ' + ev.track.kind);
            var stream = (ev.streams && ev.streams[0]) ? ev.streams[0] : new MediaStream([ev.track]);
            if (ev.track.kind === 'audio') {
                var ael = $('remote-audio');
                ael.srcObject = stream;
                ael.play().catch(function() {});
            }
            if (ev.track.kind === 'video') {
                var vel = $('remote-vid');
                vel.srcObject = stream;
                vel.style.display = 'block';
                $('call-bg').style.display = 'none';
                $('call-topbar').style.display = 'flex';
                vel.play().catch(function() {});
            }
        };

        // Состояние ICE — главный индикатор
        pc.oniceconnectionstatechange = function() {
            var s = pc.iceConnectionState;
            callLog('ICE: ' + s);
            if (s === 'connected' || s === 'completed') {
                setCallSt('СОЕДИНЕНО ✓');
                if (!RTC.timer) startCallTimer();
            }
            if (s === 'disconnected') setCallSt('ПЕРЕПОДКЛЮЧЕНИЕ...');
            if (s === 'failed') {
                setCallSt('НЕТ СВЯЗИ ✗');
                // ICE restart если мы инициатор
                if (RTC.pc && RTC.isCallerSide) {
                    callLog('ICE restart...');
                    RTC.pc.restartIce();
                } else {
                    setTimeout(function() { addSys('Звонок: нет связи');
                        rtcClean(); }, 2000);
                }
            }
        };

        pc.onconnectionstatechange = function() {
            callLog('Conn: ' + pc.connectionState);
            if (pc.connectionState === 'failed') { addSys('Соединение прервано');
                rtcClean(); }
        };

        return pc;
    }

    async function flushIce() {
        for (var i = 0; i < RTC.iceQ.length; i++) {
            try { await RTC.pc.addIceCandidate(new RTCIceCandidate(RTC.iceQ[i])); } catch (e) { console.warn('[ice flush]', e.message); }
        }
        RTC.iceQ = [];
    }

    // ── Звонящий ──
    async function startCall(type) {
        if (!S.peer) { alert('Сначала откройте личный чат'); return; }
        if (RTC.pc) { alert('Звонок уже активен'); return; }

        RTC.withVid = (type === 'video');
        RTC.isCallerSide = true;

        try { RTC.local = await getMedia(RTC.withVid); } catch (e) { alert(e.message); return; }
        if (RTC.withVid && RTC.local.getVideoTracks().length === 0) RTC.withVid = false;

        showCallOv(S.peer);
        setCallSt('ПОДГОТОВКА...');

        if (RTC.withVid) {
            $('call-pip-vid').srcObject = RTC.local;
            $('call-pip-vid').play().catch(function() {});
            $('call-pip').style.display = 'block';
        }

        buildPc(S.peer, await getIceServers());

        try {
            var offer = await RTC.pc.createOffer();
            await RTC.pc.setLocalDescription(offer);
        } catch (e) { alert('Ошибка offer: ' + e.message);
            rtcClean(); return; }

        wsSend({
            type: 'call-offer',
            to: S.peer,
            offer: RTC.pc.localDescription,
            fromName: S.name,
            withVideo: RTC.withVid
        });
        setCallSt('ЖДЁМ ОТВЕТА...');
    }

    // ── Входящий звонок ──
    function rtcOffer(m) {
        if (RTC.pc) { wsSend({ type: 'call-decline', to: m.from }); return; }

        RTC.incOffer = m.offer;
        RTC.incFrom = m.from;
        RTC.incVid = !!m.withVideo;
        RTC.isCallerSide = false;

        $('inc-name').textContent = RTC.incFrom;
        $('inc-label').textContent = RTC.incVid ? '📹 Видеозвонок' : '📞 Голосовой звонок';
        var avb = $('ans-vid-btn');
        if (avb) avb.style.display = RTC.incVid ? '' : 'none';
        $('incoming').classList.add('active');

        // Звук
        try {
            var ac = new(window.AudioContext || window.webkitAudioContext)();
            [0, 0.3, 0.6].forEach(function(t) {
                var o = ac.createOscillator(),
                    g = ac.createGain();
                o.frequency.value = 880;
                g.gain.value = 0.07;
                o.connect(g);
                g.connect(ac.destination);
                o.start(ac.currentTime + t);
                o.stop(ac.currentTime + t + 0.18);
            });
            setTimeout(function() { try { ac.close(); } catch (e) {} }, 1500);
        } catch (e) {}
    }

    // ── Ответить ──
    async function answerCall(withVid) {
        $('incoming').classList.remove('active');
        RTC.withVid = !!withVid && RTC.incVid;

        try { RTC.local = await getMedia(RTC.withVid); } catch (e) { alert(e.message); return; }
        if (RTC.withVid && RTC.local.getVideoTracks().length === 0) RTC.withVid = false;

        if (RTC.withVid) {
            $('call-pip-vid').srcObject = RTC.local;
            $('call-pip-vid').play().catch(function() {});
            $('call-pip').style.display = 'block';
        }

        showCallOv(RTC.incFrom);
        setCallSt('СОЕДИНЯЕМСЯ...');
        buildPc(RTC.incFrom, await getIceServers());

        try {
            await RTC.pc.setRemoteDescription(new RTCSessionDescription(RTC.incOffer));
            RTC.sdpSet = true;
            await flushIce();
            var answer = await RTC.pc.createAnswer();
            await RTC.pc.setLocalDescription(answer);
        } catch (e) { alert('Ошибка ответа: ' + e.message);
            rtcClean(); return; }

        wsSend({ type: 'call-answer', to: RTC.incFrom, answer: RTC.pc.localDescription });
    }

    function declineCall() {
        $('incoming').classList.remove('active');
        if (RTC.incFrom) wsSend({ type: 'call-decline', to: RTC.incFrom });
        RTC.incOffer = null;
        RTC.incFrom = null;
    }

    async function rtcAnswer(m) {
        if (!RTC.pc) return;
        try {
            await RTC.pc.setRemoteDescription(new RTCSessionDescription(m.answer));
            RTC.sdpSet = true;
            await flushIce();
        } catch (e) { console.error('[rtcAnswer]', e); }
    }

    async function rtcIce(m) {
        if (!RTC.pc || !m.candidate) return;
        if (RTC.sdpSet) {
            try { await RTC.pc.addIceCandidate(new RTCIceCandidate(m.candidate)); } catch (e) { console.warn('[addIce]', e.message); }
        } else {
            RTC.iceQ.push(m.candidate);
        }
    }

    function endCall() {
        var p = S.peer || RTC.incFrom;
        if (p) wsSend({ type: 'call-end', to: p });
        rtcClean();
    }

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
        if (rv) { try { rv.pause();
                rv.srcObject = null; } catch (e) {}
            rv.style.display = 'none'; }
        var pv = $('call-pip-vid');
        if (pv) { try { pv.pause();
                pv.srcObject = null; } catch (e) {} }
        $('call-pip').style.display = 'none';
        var ra = $('remote-audio');
        if (ra) { try { ra.pause();
                ra.srcObject = null; } catch (e) {} }

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
        RTC.incOffer = null;
        RTC.incFrom = null;
        RTC.incVid = false;
        RTC.isCallerSide = false;

        var bm = $('cbtn-mic');
        if (bm) { bm.textContent = '🎤';
            bm.classList.remove('off'); }
        var bc = $('cbtn-cam');
        if (bc) { bc.textContent = '📹';
            bc.classList.remove('off'); }
    }

    function toggleMute() {
        if (!RTC.local) return;
        RTC.muted = !RTC.muted;
        RTC.local.getAudioTracks().forEach(function(t) { t.enabled = !RTC.muted; });
        var b = $('cbtn-mic');
        b.textContent = RTC.muted ? '🔇' : '🎤';
        b.classList.toggle('off', RTC.muted);
    }

    function toggleVideo() {
        if (!RTC.local) return;
        RTC.vidOff = !RTC.vidOff;
        RTC.local.getVideoTracks().forEach(function(t) { t.enabled = !RTC.vidOff; });
        var b = $('cbtn-cam');
        b.textContent = RTC.vidOff ? '🚫' : '📹';
        b.classList.toggle('off', RTC.vidOff);
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

    function setCallSt(t) {
        var el = $('call-st');
        if (el) el.textContent = t;
        console.log('[call]', t);
    }

    function startCallTimer() {
        RTC.t0 = Date.now();
        RTC.timer = setInterval(function() {
            var s = Math.floor((Date.now() - RTC.t0) / 1000),
                v = fmtD(s);
            $('call-tmr').textContent = v;
            $('call-tb-tmr').textContent = v;
        }, 1000);
    }


    // ════════════════════════════════════════════
    // EMOJI PICKER + РЕАКЦИИ + EMOJI INPUT
    // ════════════════════════════════════════════

    var EMOJI_QUICK = ['👍', '❤️', '😂', '😮', '😢', '🔥', '👏', '🎉', '😍', '🤔', '💯', '✅', '😡', '🥹', '🫡', '💀', '🙏', '⚡'];
    var EMOJI_ALL = ['😀', '😁', '😂', '🤣', '😄', '😅', '😆', '😇', '😉', '😊', '😋', '😌', '😍', '🥰', '😎', '😏', '😐', '😑', '😒', '😓', '😔', '😕', '😖', '😗', '😘', '😙', '😚', '😛', '😜', '😝', '😞', '😟', '😠', '😡', '😢', '😣', '😤', '😥', '😦', '😧', '😨', '😩', '😪', '😫', '😬', '😭', '😮', '😯', '😰', '😱', '😲', '😳', '😴', '😵', '🤐', '🤑', '🤒', '🤓', '🤔', '🤕', '🤗', '🤠', '🤡', '🤢', '🤣', '🤤', '🤥', '🤧', '🤨', '🤩', '🤪', '🤫', '🤬', '🤭', '🤯', '🤮', '🥱', '🥲', '🥳', '🥴', '🥵', '🥶', '🥸', '🥹', '🫠', '🫡', '🫢', '🫤', '🫥',
        '👋', '🤚', '✋', '👌', '✌️', '🤞', '👍', '👎', '✊', '👊', '👏', '🙌', '🤝', '🙏', '💪',
        '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '❤️‍🔥',
        '🌸', '🌺', '🌻', '🌹', '🌷', '🌼', '💐', '🍀', '🌿', '🍃', '🌱', '🎄', '🌲', '🌳', '🌴', '🌵', '🍄', '🌊', '💧', '🔥', '⭐', '🌟', '✨', '💫', '⚡', '🌈', '☀️', '☁️', '🌧', '❄️', '🌙',
        '🎂', '🍰', '🧁', '🍭', '🍫', '🍩', '🍪', '🍦', '☕', '🍵', '🧋', '🎮', '🎲', '🎯', '🎨', '🎵', '🎶', '🎸', '🏆', '🎉', '🎊', '🎁', '👑', '💎', '🔮'
    ];

    var lpTimer = null;
    var eiOpen = false;

    // Floating emoji picker для реакций
    function showEmojiPicker(msgId, anchor) {
        closeEmojiPicker();
        var picker = document.createElement('div');
        picker.id = 'emoji-picker';
        picker.className = 'emoji-picker';
        EMOJI_QUICK.forEach(function(em) {
            var b = document.createElement('button');
            b.className = 'ep-btn';
            b.textContent = em;
            b.onclick = function(e) { e.stopPropagation();
                addReaction(msgId, em);
                closeEmojiPicker(); };
            picker.appendChild(b);
        });
        document.body.appendChild(picker);
        var r = anchor.getBoundingClientRect();
        var pw = picker.offsetWidth || 292;
        var ph = picker.offsetHeight || 56;
        var left = Math.max(6, Math.min(r.left, window.innerWidth - pw - 6));
        var top = r.top - ph - 10;
        if (top < 6) top = r.bottom + 8;
        picker.style.left = left + 'px';
        picker.style.top = top + 'px';
        requestAnimationFrame(function() { picker.classList.add('visible'); });
    }

    function closeEmojiPicker() {
        var p = document.getElementById('emoji-picker');
        if (p) p.remove();
    }
    document.addEventListener('click', function(e) {
        var p = document.getElementById('emoji-picker');
        if (p && !p.contains(e.target)) closeEmojiPicker();
    });

    function addReaction(msgId, emoji) {
        wsSend({ type: 'reaction', room: S.room, msgId: msgId, emoji: emoji });
    }

    function onReactionUpdate(m) {
        if (m.room !== S.room) return;
        var row = document.querySelector('[data-mid="' + m.msgId + '"]');
        if (!row) return;
        var body = row.querySelector('.msg-body');
        if (!body) return;
        var rb = body.querySelector('.reactions-bar');
        if (!rb) { rb = document.createElement('div');
            rb.className = 'reactions-bar';
            body.appendChild(rb); }
        rb.innerHTML = '';
        if (!m.reactions) return;
        Object.keys(m.reactions).forEach(function(em) {
            var us = m.reactions[em];
            if (!us || !us.length) return;
            var mine = us.indexOf(S.name) !== -1;
            var chip = document.createElement('button');
            chip.className = 'reaction-chip' + (mine ? ' mine' : '');
            chip.title = us.join(', ');
            chip.innerHTML = '<span class="rc-em">' + em + '</span><span class="rc-n">' + us.length + '</span>';
            chip.onclick = function(e) { e.stopPropagation();
                addReaction(m.msgId, em); };
            rb.appendChild(chip);
        });
    }

    function msgLongPressStart(e, msgId) {
        clearTimeout(lpTimer);
        lpTimer = setTimeout(function() {
            var row = document.querySelector('[data-mid="' + msgId + '"]');
            if (row) showEmojiPicker(msgId, row);
        }, 480);
    }

    function msgLongPressEnd() { clearTimeout(lpTimer); }

    // Emoji panel в инпуте
    function toggleEmojiInput(e) {
        if (e) e.stopPropagation();
        eiOpen = !eiOpen;
        var panel = document.getElementById('emoji-input-panel');
        if (!panel) return;
        if (eiOpen) {
            if (!panel.childElementCount) {
                EMOJI_QUICK.concat(EMOJI_ALL).forEach(function(em) {
                    var b = document.createElement('button');
                    b.className = 'ep-btn';
                    b.textContent = em;
                    b.onclick = function() {
                        var inp = document.getElementById('msg-input');
                        if (!inp) return;
                        var s = inp.selectionStart || inp.value.length;
                        inp.value = inp.value.slice(0, s) + em + inp.value.slice(s);
                        inp.selectionStart = inp.selectionEnd = s + em.length;
                        inp.dispatchEvent(new Event('input', { bubbles: true }));
                        inp.focus();
                    };
                    panel.appendChild(b);
                });
            }
            panel.classList.add('open');
            var eb = document.getElementById('btn-emoji');
            if (eb) eb.style.color = 'var(--accent)';
        } else {
            panel.classList.remove('open');
            var eb = document.getElementById('btn-emoji');
            if (eb) eb.style.color = '';
        }
    }

    // ════════════════════════════════════════
    // PWA — Service Worker + Push Notifications
    // ════════════════════════════════════════

    async function initPwa(userName) {
        if (!('serviceWorker' in navigator)) return;
        try {
            var reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
            console.log('[PWA] SW registered');
            navigator.serviceWorker.addEventListener('message', function(e) {
                if (e.data && e.data.type === 'bg-sync') {
                    if (!S.ws || S.ws.readyState > 1) initWs();
                }
            });
            await setupPush(reg, userName);
        } catch (e) { console.warn('[PWA] SW:', e); }
    }

    async function setupPush(reg, userName) {
        if (!('PushManager' in window)) return;
        var perm = Notification.permission;
        if (perm === 'denied') return;
        var vapidKey;
        try {
            var r = await fetch('/api/push/vapid-key');
            vapidKey = (await r.json()).publicKey;
        } catch (e) { return; }
        var sub;
        try {
            sub = await reg.pushManager.getSubscription();
            if (!sub) {
                if (perm !== 'granted') perm = await Notification.requestPermission();
                if (perm !== 'granted') return;
                sub = await reg.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey: urlBase64ToUint8(vapidKey)
                });
            }
        } catch (e) { console.warn('[PWA] subscribe:', e); return; }
        try {
            await fetch('/api/push/subscribe', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ user: userName, subscription: sub.toJSON() })
            });
            console.log('[PWA] Push ready');
        } catch (e) {}
    }

    function urlBase64ToUint8(b64) {
        var pad = '='.repeat((4 - b64.length % 4) % 4);
        var raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
        var arr = new Uint8Array(raw.length);
        for (var i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
        return arr;
    }

    // ════════════════════════════════════════
    // СИСТЕМА ДРУЗЕЙ
    // ════════════════════════════════════════

    function onFriendsData(m) {
        S.friends = m.friends.friends || [];
        S.incoming = m.friends.incoming || [];
        S.outgoing = m.friends.outgoing || [];
        renderFriends();
        renderDm();
        updBadges();
    }

    function onFriendResult(m) {
        if (m.result === 'sent') {
            showToast('Запрос отправлен → ' + m.to);
            S.outgoing.push(m.to);
            renderFriends();
        } else if (m.result === 'already') {
            showToast('Уже в друзьях');
        } else if (m.result === 'pending') {
            showToast('Запрос уже отправлен');
        } else if (m.result === 'accepted') {
            showToast('Вы теперь друзья с ' + m.to + ' 🎉');
        } else if (m.result === 'self') {
            showToast('Нельзя добавить себя');
        }
    }

    function onFriendIncoming(m) {
        S.incoming = m.pending || [];
        renderFriends();
        updBadges();
        // Show toast
        var toast = $('friend-toast');
        var tname = $('fr-toast-name');
        if (toast && tname) {
            tname.textContent = m.from;
            tname.dataset.from = m.from;
            toast.style.display = 'block';
            clearTimeout(toast._t);
            toast._t = setTimeout(function() { toast.style.display = 'none'; }, 12000);
        }
    }

    function onFriendAccepted(m) {
        showToast(m.by + ' принял твой запрос 🎉');
    }

    function frAccept(fromName) {
        wsSend({ type: 'friend-accept', from: fromName });
        S.incoming = S.incoming.filter(function(n) { return n !== fromName; });
        var toast = $('friend-toast');
        if (toast) toast.style.display = 'none';
        renderFriends();
    }

    function frDecline(fromName) {
        wsSend({ type: 'friend-decline', from: fromName });
        S.incoming = S.incoming.filter(function(n) { return n !== fromName; });
        var toast = $('friend-toast');
        if (toast) toast.style.display = 'none';
        renderFriends();
    }

    function frRemove(name) {
        if (!confirm('Удалить ' + name + ' из друзей?')) return;
        wsSend({ type: 'friend-remove', other: name });
    }

    function frSendRequest(name) {
        wsSend({ type: 'friend-request', to: name });
    }

    // Search users (client-side filter from known list)
    var frSearchTimer = null;

    function frSearch(query) {
        clearTimeout(frSearchTimer);
        frSearchTimer = setTimeout(function() { doFrSearch(query.trim()); }, 200);
    }

    function doFrSearch(q) {
        var box = $('fr-search-results');
        if (!box) return;
        box.innerHTML = '';
        if (!q || q.length < 2) { return; }
        // Filter from online list + known friends
        var known = new Set(S.friends.concat(S.incoming).concat(S.outgoing).concat(S.online));
        known.delete(S.name);
        var matches = Array.from(known).filter(function(n) {
            return n.toLowerCase().includes(q.toLowerCase());
        }).slice(0, 8);

        if (matches.length === 0) {
            // Show "send request to username" option
            (function() {
                var btn = document.createElement('button');
                btn.className = 'fr-action-btn';
                btn.textContent = '+ Добавить';
                btn.onclick = function() { frSendRequest(q); };
                var itm = document.createElement('div');
                itm.className = 'fr-search-item';
                itm.innerHTML = '<div class="fr-search-av" style="background:#1e2d45;color:#60a5fa">' + q[0].toUpperCase() + '</div>' +
                    '<div class="fr-search-info"><div class="fr-search-name">' + esc(q) + '</div>' +
                    '<div class="fr-search-sub">Отправить запрос</div></div>';
                itm.appendChild(btn);
                box.appendChild(itm);
            })();
            return;
        }

        matches.forEach(function(nm) {
            var col = gc(nm);
            var isFriend = S.friends.includes(nm);
            var isPending = S.outgoing.includes(nm);
            var isIncoming = S.incoming.includes(nm);
            var isOnline = S.online.includes(nm);

            var item = document.createElement('div');
            item.className = 'fr-search-item';

            var avEl = document.createElement('div');
            avEl.className = 'fr-search-av';
            avEl.style.cssText = 'background:' + col + '22;color:' + col;
            avEl.textContent = ini(nm);
            item.appendChild(avEl);

            var info = document.createElement('div');
            info.className = 'fr-search-info';
            var nEl = document.createElement('div');
            nEl.className = 'fr-search-name';
            nEl.textContent = nm;
            var sEl = document.createElement('div');
            sEl.className = 'fr-search-sub';
            sEl.textContent = isOnline ? '● онлайн' : 'не в сети';
            if (isOnline) sEl.style.color = 'var(--green)';
            info.appendChild(nEl);
            info.appendChild(sEl);
            item.appendChild(info);

            if (isFriend) {
                var tag = document.createElement('span');
                tag.className = 'fr-tag-friend';
                tag.textContent = 'Друг ✓';
                item.appendChild(tag);
            } else if (isPending) {
                var tag = document.createElement('span');
                tag.className = 'fr-tag-pend';
                tag.textContent = 'Ожидает...';
                item.appendChild(tag);
            } else if (isIncoming) {
                var btn = document.createElement('button');
                btn.className = 'fr-action-btn fr-accept';
                btn.textContent = '✓ Принять';
                btn.onclick = function() { frAccept(nm); };
                item.appendChild(btn);
            } else {
                var btn = document.createElement('button');
                btn.className = 'fr-action-btn';
                btn.textContent = '+ Добавить';
                btn.onclick = function() { frSendRequest(nm); };
                item.appendChild(btn);
            }
            box.appendChild(item);
        });
    }

    function renderFriends() {
        // Incoming requests section
        var inSec = $('fr-incoming-section');
        var inList = $('fr-incoming-list');
        if (inSec && inList) {
            inSec.style.display = S.incoming.length ? '' : 'none';
            inList.innerHTML = '';
            S.incoming.forEach(function(nm) {
                var col = gc(nm);
                var d = document.createElement('div');
                d.className = 'fr-req-item';
                var av = document.createElement('div');
                av.className = 'fr-req-av';
                av.style.cssText = 'background:' + col + '22;color:' + col;
                av.textContent = ini(nm);
                var nEl = document.createElement('div');
                nEl.className = 'fr-req-name';
                nEl.textContent = nm;
                var b1 = document.createElement('button');
                b1.className = 'fr-action-btn fr-accept';
                b1.textContent = '✓';
                b1.onclick = (function(n) { return function() { frAccept(n); }; })(nm);
                var b2 = document.createElement('button');
                b2.className = 'fr-action-btn fr-deny';
                b2.textContent = '✕';
                b2.onclick = (function(n) { return function() { frDecline(n); }; })(nm);
                d.appendChild(av);
                d.appendChild(nEl);
                d.appendChild(b1);
                d.appendChild(b2);
                inList.appendChild(d);
            });
        }

        // Friends list
        var fl = $('fr-friends-list');
        var fe = $('fr-empty');
        if (!fl) return;
        fl.innerHTML = '';
        S.friends.forEach(function(nm) {
            var col = gc(nm);
            var isOnline = S.online.includes(nm);
            var dr = dmKey(nm);
            var d = document.createElement('div');
            d.className = 'fr-friend-item';
            d.innerHTML = '<div class="u-av" style="background:' + col + '22;color:' + col + '">' +
                '<span>' + ini(nm) + '</span>' +
                (isOnline ? '<span class="u-av-online"></span>' : '') +
                '</div>' +
                '</div>';
            var infoDiv = document.createElement('div');
            infoDiv.className = 'u-info';
            infoDiv.style.cssText = 'flex:1;cursor:pointer';
            infoDiv.innerHTML = '<span class="u-name">' + esc(nm) + '</span>' +
                (isOnline ? '<span class="u-status-online">онлайн</span>' : '<span class="u-status-off">не в сети</span>');
            infoDiv.onclick = (function(room, n) { return function() { openRoom(room, 'dm', n); }; })(dmKey(nm), nm);
            var rmBtn = document.createElement('button');
            rmBtn.className = 'fr-rm-btn';
            rmBtn.title = 'Удалить';
            rmBtn.textContent = '✕';
            rmBtn.onclick = (function(n) { return function() { frRemove(n); }; })(nm);
            d.appendChild(infoDiv);
            d.appendChild(rmBtn);
            fl.appendChild(d);
        });

        if (fe) fe.style.display = (S.friends.length === 0 && S.outgoing.length === 0) ? '' : 'none';

        // Outgoing (pending)
        if (S.outgoing.length) {
            var pLabel = document.createElement('div');
            pLabel.className = 'fr-section-label';
            pLabel.textContent = 'Ожидают ответа';
            fl.appendChild(pLabel);
            S.outgoing.forEach(function(nm) {
                var col = gc(nm);
                var d = document.createElement('div');
                d.className = 'fr-friend-item';
                d.style.opacity = '0.6';
                d.innerHTML = '<div class="u-av" style="background:' + col + '22;color:' + col + '">' + ini(nm) + '</div>' +
                    '<div class="u-info" style="flex:1"><span class="u-name">' + esc(nm) + '</span>' +
                    '<span class="u-status-off">запрос отправлен</span></div>';
                fl.appendChild(d);
            });
        }
        updBadges();
    }

    function showToast(msg) {
        var t = document.getElementById('mgv-toast');
        if (!t) { t = document.createElement('div');
            t.id = 'mgv-toast';
            document.body.appendChild(t); }
        t.textContent = msg;
        t.className = 'mgv-toast show';
        clearTimeout(t._timer);
        t._timer = setTimeout(function() { t.className = 'mgv-toast'; }, 3000);
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
        // iOS install banner
        (function() {
            var isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
            if (isIos && !window.navigator.standalone && !localStorage.getItem('mgv-banner')) {
                setTimeout(function() {
                    var b = document.getElementById('ios-install-banner');
                    if (b) b.style.display = 'flex';
                }, 4000);
            }
        })();
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
        addReaction,
        toggleEmojiInput,
        frAccept,
        frDecline,
        frRemove,
        frSendRequest,
        frSearch,
        attachFile: function() { $('file-input').click(); }
    };

    // Expose reaction fns to global scope (called from inline onclick in innerHTML)
    window._mgvReact = addReaction;
    window._mgvPicker = showEmojiPicker;

})();
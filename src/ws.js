// src/ws.js — WebSocket message handler
const db = require('./db');

// sessions: name -> ws
const sessions = new Map();

function broadcast(names, payload) {
  var str = JSON.stringify(payload);
  names.forEach(function(name) {
    var ws = sessions.get(name);
    if (ws && ws.readyState === 1) ws.send(str);
  });
}

function broadcastAll(payload) {
  broadcast(Array.from(sessions.keys()), payload);
}

function broadcastOnlineList() {
  broadcastAll({ type: 'online', users: Array.from(sessions.keys()) });
}

function setup(wss) {
  wss.on('connection', function(ws) {
    var myName = null;

    ws.on('message', function(raw) {
      var msg;
      try { msg = JSON.parse(raw); } catch(e) { return; }

      // ── AUTH ──
      if (msg.type === 'auth') {
        var name = String(msg.name || '').trim().slice(0, 30);
        var pass = String(msg.pass || '');
        if (!name || !pass) {
          return ws.send(JSON.stringify({ type: 'auth-fail', reason: 'Имя и пароль обязательны' }));
        }
        var check = db.checkUser(name, pass);
        if (check === 'notfound') {
          // register new user
          db.createUser(name, pass, 'user');
        } else if (check === 'wrongpass') {
          return ws.send(JSON.stringify({ type: 'auth-fail', reason: 'Неверный пароль' }));
        } else if (check === 'banned') {
          return ws.send(JSON.stringify({ type: 'auth-fail', reason: 'Аккаунт заблокирован' }));
        }
        // kick old session
        if (sessions.has(name)) {
          try { sessions.get(name).send(JSON.stringify({ type: 'kicked', reason: 'Вход с другого устройства' })); sessions.get(name).close(); } catch(e) {}
        }
        myName = name;
        sessions.set(name, ws);
        var user = db.getUser(name);
        ws.send(JSON.stringify({ type: 'auth-ok', name: name, role: user.role }));
        // send channels list
        ws.send(JSON.stringify({ type: 'channels', channels: Object.values(db.getAllChannels()) }));
        broadcastOnlineList();
        return;
      }

      if (!myName) return; // not authed
      var user = db.getUser(myName);

      // ── CHANNEL HISTORY ──
      if (msg.type === 'get-history') {
        var room = String(msg.room || '');
        if (!room) return;
        // For DMs, room is "dm:a:b"
        var messages = db.getMessages(room, 100);
        ws.send(JSON.stringify({ type: 'history', room: room, messages: messages }));

      // ── CHANNEL MESSAGE ──
      } else if (msg.type === 'channel-msg') {
        var room = String(msg.room || '');
        var text = String(msg.text || '').trim().slice(0, 4000);
        var file = msg.file || null; // { url, name, size, mime }
        if (!room || (!text && !file)) return;
        var ch = db.getChannel(room);
        if (!ch && !room.startsWith('dm:')) return;
        var saved = db.addMessage(room, myName, { text: text, file: file, type: file ? 'file' : 'text' });
        // Broadcast to everyone online (clients filter by current room)
        broadcastAll({ type: 'channel-msg', room: room, message: saved });

      // ── DM ──
      } else if (msg.type === 'dm') {
        var toName = String(msg.to || '');
        var text = String(msg.text || '').trim().slice(0, 4000);
        var file = msg.file || null;
        if (!toName || (!text && !file)) return;
        var room = db.dmKey(myName, toName);
        var saved = db.addMessage(room, myName, { text: text, file: file, type: file ? 'file' : 'text' });
        // send to both
        broadcast([myName, toName], { type: 'channel-msg', room: room, message: saved });

      // ── DELETE MESSAGE (admin or own) ──
      } else if (msg.type === 'delete-msg') {
        var room = String(msg.room || '');
        var msgId = String(msg.msgId || '');
        var messages = db.getMessages(room);
        var target = messages.find(function(m) { return m.id === msgId; });
        if (!target) return;
        if (target.from !== myName && user.role !== 'admin') return;
        db.deleteMessage(room, msgId);
        broadcastAll({ type: 'msg-deleted', room: room, msgId: msgId });

      // ── TYPING ──
      } else if (msg.type === 'typing') {
        var room = String(msg.room || '');
        broadcastAll({ type: 'typing', room: room, from: myName });

      // ── CREATE CHANNEL (admin) ──
      } else if (msg.type === 'create-channel') {
        if (user.role !== 'admin') return;
        var cname = String(msg.name || '').trim().slice(0, 30).replace(/\s+/g, '-').toLowerCase();
        if (!cname || db.getChannel(cname)) return;
        var ch = db.createChannel(cname, {
          name: cname,
          description: String(msg.description || ''),
          type: msg.channelType || 'public',
          createdBy: myName
        });
        broadcastAll({ type: 'channels', channels: Object.values(db.getAllChannels()) });

      // ── DELETE CHANNEL (admin) ──
      } else if (msg.type === 'delete-channel') {
        if (user.role !== 'admin') return;
        var cid = String(msg.id || '');
        if (!cid || cid === 'general') return;
        db.deleteChannel(cid);
        broadcastAll({ type: 'channels', channels: Object.values(db.getAllChannels()) });

      // ── ADMIN: ban/unban user ──
      } else if (msg.type === 'ban-user') {
        if (user.role !== 'admin') return;
        var target = String(msg.name || '');
        if (!target || target === 'admin') return;
        db.updateUser(target, { banned: true });
        if (sessions.has(target)) {
          try { sessions.get(target).send(JSON.stringify({ type: 'kicked', reason: 'Вы заблокированы' })); sessions.get(target).close(); } catch(e) {}
        }
        ws.send(JSON.stringify({ type: 'admin-ok', action: 'ban', target: target }));

      } else if (msg.type === 'unban-user') {
        if (user.role !== 'admin') return;
        var target = String(msg.name || '');
        db.updateUser(target, { banned: false });
        ws.send(JSON.stringify({ type: 'admin-ok', action: 'unban', target: target }));

      // ── ADMIN: delete user ──
      } else if (msg.type === 'delete-user') {
        if (user.role !== 'admin') return;
        var target = String(msg.name || '');
        if (!target || target === 'admin') return;
        if (sessions.has(target)) { try { sessions.get(target).close(); } catch(e) {} }
        db.deleteUser(target);
        ws.send(JSON.stringify({ type: 'admin-ok', action: 'delete', target: target }));

      // ── ADMIN: set role ──
      } else if (msg.type === 'set-role') {
        if (user.role !== 'admin') return;
        var target = String(msg.name || '');
        var role = msg.role === 'admin' ? 'admin' : 'user';
        db.updateUser(target, { role: role });
        ws.send(JSON.stringify({ type: 'admin-ok', action: 'role', target: target, role: role }));

      // ── ADMIN: get stats ──
      } else if (msg.type === 'admin-stats') {
        if (user.role !== 'admin') return;
        var allUsers = db.getAllUsers();
        var allChannels = db.getAllChannels();
        var allUploads = db.getAllUploads();
        ws.send(JSON.stringify({
          type: 'admin-stats',
          users: Object.entries(allUsers).map(function(e) {
            return { name: e[0], role: e[1].role, banned: e[1].banned, createdAt: e[1].createdAt, online: sessions.has(e[0]) };
          }),
          channels: Object.values(allChannels),
          uploads: allUploads.slice(-50),
          onlineCount: sessions.size
        }));

      // ── WebRTC signaling (by name) ──
      } else if (['call-offer','call-answer','ice','call-end','call-decline'].indexOf(msg.type) !== -1) {
        var toName = String(msg.to || '');
        var dest = sessions.get(toName);
        if (dest && dest.readyState === 1) {
          var payload = Object.assign({}, msg, { from: myName });
          delete payload.to;
          dest.send(JSON.stringify(payload));
        }
      }
    });

    ws.on('close', function() {
      if (myName && sessions.get(myName) === ws) {
        sessions.delete(myName);
        broadcastOnlineList();
      }
    });
  });
}

module.exports = { setup, sessions };

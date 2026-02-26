// src/db.js — JSON-based persistent storage
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');

function filePath(name) { return path.join(DATA_DIR, name + '.json'); }

function load(name, def) {
    try { return JSON.parse(fs.readFileSync(filePath(name), 'utf8')); } catch (e) { return def; }
}

function save(name, data) {
    fs.writeFileSync(filePath(name), JSON.stringify(data, null, 2), 'utf8');
}

// ── Users ──
// { name: { passwordHash, role, createdAt, avatar, banned } }
let users = load('users', {});

function hashPass(pass) {
    return crypto.createHash('sha256').update('mgv2025:' + pass).digest('hex');
}

function createUser(name, pass, role) {
    users[name] = {
        passwordHash: hashPass(pass),
        role: role || 'user',
        createdAt: Date.now(),
        avatar: null,
        banned: false
    };
    save('users', users);
}

function checkUser(name, pass) {
    var u = users[name];
    if (!u) return 'notfound';
    if (u.banned) return 'banned';
    if (u.passwordHash !== hashPass(pass)) return 'wrongpass';
    return 'ok';
}

function getUser(name) { return users[name] || null; }

function getAllUsers() { return users; }

function updateUser(name, fields) {
    if (!users[name]) return;
    Object.assign(users[name], fields);
    save('users', users);
}

function deleteUser(name) {
    delete users[name];
    save('users', users);
}

// Ensure admin exists
if (!users['admin']) {
    createUser('admin', 'admin123', 'admin');
    console.log('  [db] Created default admin: admin / admin123');
}

// ── Channels ──
// { id: { name, description, type, createdBy, createdAt, members[] } }
let channels = load('channels', {});

function createChannel(id, data) {
    channels[id] = Object.assign({ id, createdAt: Date.now(), members: [] }, data);
    save('channels', channels);
    return channels[id];
}

function getChannel(id) { return channels[id] || null; }

function getAllChannels() { return channels; }

function updateChannel(id, fields) {
    if (!channels[id]) return;
    Object.assign(channels[id], fields);
    save('channels', channels);
}

function deleteChannel(id) {
    delete channels[id];
    delete msgs[id];
    save('channels', channels);
    save('messages', msgs);
}

// Ensure general channel exists
if (!channels['general']) {
    createChannel('general', { name: 'general', description: 'Общий чат', type: 'public', createdBy: 'admin' });
}
if (!channels['random']) {
    createChannel('random', { name: 'random', description: 'Случайные темы', type: 'public', createdBy: 'admin' });
}

// ── Messages ──
// { channelId: [{id, from, text, type, file, time, edited}] }
// DMs stored as "dm:alice:bob" (sorted)
let msgs = load('messages', {});

function dmKey(a, b) { return 'dm:' + [a, b].sort().join(':'); }

function addMessage(room, from, data) {
    if (!msgs[room]) msgs[room] = [];
    var msg = Object.assign({ id: crypto.randomBytes(6).toString('hex'), from, time: Date.now() }, data);
    msgs[room].push(msg);
    if (msgs[room].length > 1000) msgs[room].shift();
    save('messages', msgs);
    return msg;
}

function getMessages(room, limit) {
    var arr = msgs[room] || [];
    return limit ? arr.slice(-limit) : arr;
}

function deleteMessage(room, msgId) {
    if (!msgs[room]) return;
    msgs[room] = msgs[room].filter(function(m) { return m.id !== msgId; });
    save('messages', msgs);
}

// reactions: { msgId: { emoji: [userName, ...] } }
function toggleReaction(room, msgId, emoji, userName) {
    if (!msgs[room]) return null;
    var msg = msgs[room].find(function(m) { return m.id === msgId; });
    if (!msg) return null;
    if (!msg.reactions) msg.reactions = {};
    if (!msg.reactions[emoji]) msg.reactions[emoji] = [];
    var idx = msg.reactions[emoji].indexOf(userName);
    if (idx === -1) {
        msg.reactions[emoji].push(userName);
    } else {
        msg.reactions[emoji].splice(idx, 1);
        if (msg.reactions[emoji].length === 0) delete msg.reactions[emoji];
    }
    save('messages', msgs);
    return msg.reactions;
}

// ── Uploads ──
const UPLOADS_DIR = path.join(__dirname, '..', 'public', 'uploads');

function registerUpload(filename, originalName, uploader, size, mimetype) {
    var uploads = load('uploads', []);
    uploads.push({ filename, originalName, uploader, size, mimetype, time: Date.now() });
    if (uploads.length > 5000) uploads.shift();
    save('uploads', uploads);
}

function getAllUploads() { return load('uploads', []); }

module.exports = {
    hashPass,
    createUser,
    checkUser,
    getUser,
    getAllUsers,
    updateUser,
    deleteUser,
    createChannel,
    getChannel,
    getAllChannels,
    updateChannel,
    deleteChannel,
    dmKey,
    addMessage,
    getMessages,
    deleteMessage,
    toggleReaction,
    registerUpload,
    getAllUploads,
    UPLOADS_DIR
};
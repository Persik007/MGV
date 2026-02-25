// src/routes.js — HTTP routes: static files + file upload
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const MIME = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.mp4': 'video/mp4',
    '.pdf': 'application/pdf',
    '.zip': 'application/zip',
    '.txt': 'text/plain',
    '.mp3': 'audio/mpeg',
    '.ogg': 'audio/ogg',
    '.wav': 'audio/wav',
};

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

function serveStatic(req, res) {
    var url = req.url.split('?')[0];
    if (url === '/') url = '/index.html';
    var filePath = path.join(PUBLIC_DIR, url);
    // security: no path traversal outside PUBLIC_DIR
    if (!filePath.startsWith(PUBLIC_DIR)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }
    fs.readFile(filePath, function(err, data) {
        if (err) { res.writeHead(404);
            res.end('Not found'); return; }
        var ext = path.extname(filePath).toLowerCase();
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
        res.end(data);
    });
}

function handleUpload(req, res, sessions) {
    // Parse multipart without busboy — use raw boundary parsing
    var contentType = req.headers['content-type'] || '';
    if (!contentType.includes('multipart/form-data')) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Expected multipart' }));
        return;
    }

    // Auth via query param ?token=name:pass_hash (sent from client after login)
    var url = new URL(req.url, 'http://localhost');
    var uploaderName = url.searchParams.get('user');
    if (!uploaderName || !sessions.has(uploaderName)) {
        res.writeHead(401);
        res.end(JSON.stringify({ error: 'Unauthorized' }));
        return;
    }

    var boundary = contentType.split('boundary=')[1];
    if (!boundary) { res.writeHead(400);
        res.end(JSON.stringify({ error: 'No boundary' })); return; }

    var chunks = [];
    var totalSize = 0;

    req.on('data', function(chunk) {
        totalSize += chunk.length;
        if (totalSize > MAX_FILE_SIZE) {
            req.destroy();
            res.writeHead(413);
            res.end(JSON.stringify({ error: 'File too large (max 50MB)' }));
            return;
        }
        chunks.push(chunk);
    });

    req.on('end', function() {
        var body = Buffer.concat(chunks);
        var bnd = Buffer.from('--' + boundary);
        var parts = splitBuffer(body, bnd);

        for (var i = 0; i < parts.length; i++) {
            var part = parts[i];
            if (part.length < 4) continue;
            // find header/body separator (\r\n\r\n)
            var sep = bufferIndexOf(part, Buffer.from('\r\n\r\n'));
            if (sep === -1) continue;
            var header = part.slice(0, sep).toString('utf8');
            var fileData = part.slice(sep + 4);
            // strip trailing \r\n
            if (fileData[fileData.length - 2] === 13 && fileData[fileData.length - 1] === 10) {
                fileData = fileData.slice(0, -2);
            }

            var dispMatch = header.match(/Content-Disposition:[^\r\n]*filename="([^"]+)"/i);
            if (!dispMatch) continue;
            var originalName = dispMatch[1];
            var ext = path.extname(originalName).toLowerCase().replace(/[^a-z0-9.]/g, '');
            var filename = Date.now() + '_' + crypto.randomBytes(4).toString('hex') + (ext || '');
            var savePath = path.join(db.UPLOADS_DIR, filename);

            fs.writeFileSync(savePath, fileData);

            var mimeMatch = header.match(/Content-Type:\s*([^\r\n]+)/i);
            var mime = mimeMatch ? mimeMatch[1].trim() : 'application/octet-stream';

            db.registerUpload(filename, originalName, uploaderName, fileData.length, mime);

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                url: '/uploads/' + filename,
                name: originalName,
                size: fileData.length,
                mime: mime
            }));
            return;
        }
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'No file found in upload' }));
    });
}

function splitBuffer(buf, delimiter) {
    var result = [];
    var start = 0;
    var idx;
    while ((idx = bufferIndexOf(buf, delimiter, start)) !== -1) {
        result.push(buf.slice(start, idx));
        start = idx + delimiter.length;
    }
    result.push(buf.slice(start));
    return result;
}

function bufferIndexOf(buf, search, start) {
    start = start || 0;
    for (var i = start; i <= buf.length - search.length; i++) {
        var found = true;
        for (var j = 0; j < search.length; j++) {
            if (buf[i + j] !== search[j]) { found = false; break; }
        }
        if (found) return i;
    }
    return -1;
}

function handle(req, res, sessions) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    var url = req.url.split('?')[0];

    if (req.method === 'POST' && url === '/upload') {
        return handleUpload(req, res, sessions);
    }

    // Admin API — simple REST
    if (url === '/api/stats' && req.method === 'GET') {
        var urlObj = new URL(req.url, 'http://localhost');
        var user = urlObj.searchParams.get('user');
        if (!sessions.has(user)) { res.writeHead(401);
            res.end('{}'); return; }
        var u = db.getUser(user);
        if (!u || u.role !== 'admin') { res.writeHead(403);
            res.end('{}'); return; }
        var allUsers = db.getAllUsers();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            users: Object.entries(allUsers).map(function(e) {
                return { name: e[0], role: e[1].role, banned: e[1].banned, createdAt: e[1].createdAt, online: sessions.has(e[0]) };
            }),
            channels: Object.values(db.getAllChannels()),
            uploads: db.getAllUploads().slice(-100),
            onlineCount: sessions.size
        }));
        return;
    }

    // ── ICE servers config (TURN credentials from env) ──
    if (url === '/api/ice' && req.method === 'GET') {
        getIceServers(function(ice) {
            res.writeHead(200, {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-store'
            });
            res.end(JSON.stringify(ice));
        });
        return;
    }

    serveStatic(req, res);
}

// ── ICE / TURN credentials ──
// Кеш — обновляем раз в 12 часов (Metered credentials живут 24ч)
var iceCache = null;
var iceCacheTime = 0;
var ICE_TTL = 12 * 60 * 60 * 1000;

var METERED_URL = process.env.METERED_CREDS_URL || 'https://mgv.metered.live/api/v1/turn/credentials?apiKey=c26a2ef76f54f5c0d4e8f66a0d11cb69aa2b';

function getIceServers(cb) {
    var now = Date.now();
    if (iceCache && (now - iceCacheTime) < ICE_TTL) {
        return cb(iceCache);
    }

    // Загружаем с Metered API
    var apiUrl = METERED_URL;
    fetchJson(apiUrl, function(err, data) {
        if (!err && Array.isArray(data) && data.length > 0) {
            console.log('[ICE] Metered TURN загружен, серверов:', data.length);
            iceCache = data;
            iceCacheTime = now;
            return cb(iceCache);
        }
        // Fallback — STUN only (если Metered недоступен)
        console.warn('[ICE] Metered недоступен, fallback STUN:', err && err.message);
        cb([
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun.cloudflare.com:3478' }
        ]);
    });
}

// Простой HTTP/HTTPS GET → JSON (без зависимостей)
function fetchJson(url, cb) {
    var mod = url.startsWith('https') ? require('https') : require('http');
    var req = mod.get(url, { timeout: 5000 }, function(res) {
        var body = '';
        res.on('data', function(c) { body += c; });
        res.on('end', function() {
            try { cb(null, JSON.parse(body)); } catch (e) { cb(e); }
        });
    });
    req.on('error', cb);
    req.on('timeout', function() { req.destroy(new Error('timeout')); });
}

module.exports = { handle };
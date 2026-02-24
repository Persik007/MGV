// server.js — MGV Messenger
const http = require('http');
const https = require('https');
const { WebSocketServer } = require('ws');
const { networkInterfaces } = require('os');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const routes = require('./src/routes');
const ws = require('./src/ws');

const HTTP_PORT = process.env.PORT || process.argv[2] || 3000;
const HTTPS_PORT = process.env.HTTPS_PORT || process.argv[3] || 3443;

// ── Self-signed TLS cert (auto-generated, stored so it survives restarts) ──
const CERT_DIR = path.join(__dirname, 'data');
const CERT_FILE = path.join(CERT_DIR, 'cert.pem');
const KEY_FILE = path.join(CERT_DIR, 'key.pem');

function genSelfSigned() {
    // Use openssl if available, else fall back to Node's built-in (>=15)
    try {
        const { execSync } = require('child_process');
        execSync(
            `openssl req -x509 -newkey rsa:2048 -keyout "${KEY_FILE}" -out "${CERT_FILE}" ` +
            `-days 3650 -nodes -subj "/CN=mgv-local"`, { stdio: 'ignore' }
        );
        return true;
    } catch (e) {}

    // Node built-in (v15+)
    try {
        const { generateKeyPairSync } = crypto;
        // Node doesn't have built-in x509 generation — just skip HTTPS gracefully
        return false;
    } catch (e) { return false; }
}

function getTlsOptions() {
    if (!fs.existsSync(CERT_FILE) || !fs.existsSync(KEY_FILE)) {
        if (!genSelfSigned()) return null;
    }
    try {
        return {
            key: fs.readFileSync(KEY_FILE),
            cert: fs.readFileSync(CERT_FILE)
        };
    } catch (e) { return null; }
}

// ── HTTP server (plain) ──
const httpServer = http.createServer(function(req, res) {
    // Redirect to HTTPS if we have it running
    if (tlsServer) {
        var host = (req.headers.host || '').replace(/:\d+$/, '');
        res.writeHead(301, { Location: 'https://' + host + ':' + HTTPS_PORT + req.url });
        res.end();
        return;
    }
    routes.handle(req, res, ws.sessions);
});

// ── HTTPS server ──
var tlsOpts = getTlsOptions();
var tlsServer = null;
var wss;

if (tlsOpts) {
    tlsServer = https.createServer(tlsOpts, function(req, res) {
        routes.handle(req, res, ws.sessions);
    });
    wss = new WebSocketServer({ server: tlsServer });
} else {
    // No TLS — fall back to plain HTTP
    wss = new WebSocketServer({ server: httpServer });
}

ws.setup(wss);

// ── Start ──
httpServer.listen(HTTP_PORT, function() {
    var nets = networkInterfaces();
    var ips = [];
    Object.keys(nets).forEach(function(n) {
        nets[n].forEach(function(net) {
            if (net.family === 'IPv4' && !net.internal) ips.push(net.address);
        });
    });

    console.log('\n╔══════════════════════════════════════════╗');
    console.log('║           MGV Messenger v1.1             ║');
    console.log('╚══════════════════════════════════════════╝\n');

    if (tlsServer) {
        console.log('  ✅ HTTPS (для звонков):');
        console.log('     https://localhost:' + HTTPS_PORT);
        ips.forEach(function(ip) {
            console.log('     https://' + ip + ':' + HTTPS_PORT + '  ← используй для звонков по сети');
        });
        console.log('\n  ⚠️  Браузер покажет предупреждение о сертификате.');
        console.log('     Нажми "Дополнительно" → "Перейти на сайт" — это безопасно.');
        console.log('\n  HTTP (редирект на HTTPS):');
        console.log('     http://localhost:' + HTTP_PORT);
    } else {
        console.log('  ⚠️  HTTPS недоступен (нет openssl). Звонки работают только на localhost.');
        console.log('  HTTP:');
        console.log('     http://localhost:' + HTTP_PORT);
        ips.forEach(function(ip) {
            console.log('     http://' + ip + ':' + HTTP_PORT);
        });
    }

    console.log('\n  Admin: логин admin / пароль admin123');
    console.log('  Ctrl+C для остановки\n');
});

if (tlsServer) {
    tlsServer.listen(HTTPS_PORT);
}
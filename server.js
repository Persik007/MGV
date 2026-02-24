// server.js — MGV Messenger
// Работает на Railway (и локально).
// Railway сам обеспечивает HTTPS/WSS снаружи — сервер слушает plain HTTP.

const http = require('http');
const { WebSocketServer } = require('ws');
const routes = require('./src/routes');
const ws = require('./src/ws');

// Railway даёт PORT через env; локально — 3000
const PORT = process.env.PORT || 3000;

const server = http.createServer(function(req, res) {
    routes.handle(req, res, ws.sessions);
});

// WebSocket на том же порту — Railway/nginx proxy поддерживает upgrade
const wss = new WebSocketServer({ server });
ws.setup(wss);

server.listen(PORT, function() {
    var addr = 'http://localhost:' + PORT;
    console.log('\n╔══════════════════════════════════════╗');
    console.log('║         MGV Messenger v1.1           ║');
    console.log('╚══════════════════════════════════════╝');
    console.log('\n  Local:  ' + addr);
    console.log('  Admin:  ' + addr + '/admin.html');
    console.log('\n  На Railway: используй URL из дашборда (HTTPS автоматически)');
    console.log('  Admin логин: admin / admin123');
    console.log('\n  Ctrl+C для остановки\n');
});
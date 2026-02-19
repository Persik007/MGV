// server.js — MGV Messenger entry point
const http = require('http');
const { WebSocketServer } = require('ws');
const { networkInterfaces } = require('os');
const routes = require('./src/routes');
const ws = require('./src/ws');

const PORT = process.env.PORT || process.argv[2] || 3000;

const server = http.createServer(function(req, res) {
    routes.handle(req, res, ws.sessions);
});

const wss = new WebSocketServer({ server });
ws.setup(wss);

server.listen(PORT, function() {
    console.log('\n╔══════════════════════════════════════════╗');
    console.log('║           MGV Messenger v1.0             ║');
    console.log('╚══════════════════════════════════════════╝');
    console.log('\n  App:    http://localhost:' + PORT);
    console.log('  Admin:  http://localhost:' + PORT + '/admin.html');
    console.log('\n  Default admin login: admin / admin123');
    console.log('\n  Local network:');
    var nets = networkInterfaces();
    Object.keys(nets).forEach(function(n) {
        nets[n].forEach(function(net) {
            if (net.family === 'IPv4' && !net.internal)
                console.log('    http://' + net.address + ':' + PORT);
        });
    });
    console.log('\n  Ctrl+C to stop\n');
});
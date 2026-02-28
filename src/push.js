// src/push.js — Web Push sender (VAPID, no external deps)
'use strict';
const crypto = require('crypto');
const https = require('https');
const http = require('http');
const url_mod = require('url');

// ── VAPID keys (set via env or defaults below — CHANGE IN PRODUCTION) ──
const VAPID_PUBLIC = process.env.VAPID_PUBLIC || 'BJCg8A1V-JuwKg8OhGyqt8RQG0KVXpJD0GgE2245sGp62BAGz8nII_pKD_ov27iQzm-57QgtWGvgvmQU3wFtTEs';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE || 'X7oIp4oAMCa7vBYyz-tpap5bg-Hgt62cGFWRNii09MU';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@mgv.app';

// ── Subscription storage (in-memory + file-backed) ──
const fs = require('fs');
const path = require('path');
const DATA_DIR = path.join(__dirname, '..', 'data');
const SUB_FILE = path.join(DATA_DIR, 'push_subs.json');

let subs = {}; // { userName: [subscription, ...] }
try { subs = JSON.parse(fs.readFileSync(SUB_FILE, 'utf8')); } catch (e) { subs = {}; }

function saveSubs() {
    try { fs.writeFileSync(SUB_FILE, JSON.stringify(subs, null, 2)); } catch (e) {}
}

function addSub(userName, sub) {
    if (!subs[userName]) subs[userName] = [];
    // Avoid duplicate endpoints
    var ep = sub.endpoint;
    subs[userName] = subs[userName].filter(function(s) { return s.endpoint !== ep; });
    subs[userName].push(sub);
    saveSubs();
}

function removeSub(endpoint) {
    Object.keys(subs).forEach(function(name) {
        subs[name] = (subs[name] || []).filter(function(s) { return s.endpoint !== endpoint; });
    });
    saveSubs();
}

function getSubsForUser(userName) {
    return subs[userName] || [];
}

function getAllSubs() { return subs; }

// ── Base64url helpers ──
function b64u(buf) {
    return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function fromb64u(str) {
    return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

// ── VAPID JWT ──
function makeVapidJwt(audience) {
    var header = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
    var payload = b64u(JSON.stringify({
        aud: audience,
        exp: Math.floor(Date.now() / 1000) + 12 * 3600,
        sub: VAPID_SUBJECT
    }));
    var signing = header + '.' + payload;

    // Import private key
    var privRaw = fromb64u(VAPID_PRIVATE);
    // Build PKCS8 for P-256
    var prefix = Buffer.from('308141020100301306072a8648ce3d020106082a8648ce3d030107042730250201010420', 'hex');
    var pkcs8 = Buffer.concat([prefix, privRaw]);

    var privKey = crypto.createPrivateKey({ key: pkcs8, format: 'der', type: 'pkcs8' });
    var sig = crypto.sign('SHA256', Buffer.from(signing), { key: privKey, dsaEncoding: 'ieee-p1363' });

    return signing + '.' + b64u(sig);
}

// ── Encrypt push payload (RFC 8291 / aesgcm) ──
function encryptPayload(sub, payload) {
    var keys = sub.keys;
    if (!keys || !keys.p256dh || !keys.auth) return null;

    var clientPubKey = fromb64u(keys.p256dh); // 65 bytes uncompressed
    var clientAuth = fromb64u(keys.auth); // 16 bytes

    // Generate server ephemeral key pair
    var serverKey = crypto.generateKeyPairSync('ec', {
        namedCurve: 'prime256v1',
        publicKeyEncoding: { type: 'spki', format: 'der' },
        privateKeyEncoding: { type: 'pkcs8', format: 'der' }
    });

    var serverPubRaw = serverKey.publicKey.slice(-65);
    var serverPrivKey = crypto.createPrivateKey({ key: serverKey.privateKey, format: 'der', type: 'pkcs8' });
    var clientPubKeyObj = crypto.createPublicKey({ key: clientPubKey, format: 'der', type: 'spki' });

    // ECDH shared secret
    var sharedBuf = crypto.diffieHellman({ privateKey: serverPrivKey, publicKey: clientPubKeyObj });
    var sharedSecret = Buffer.from(sharedBuf);

    // PRK via HKDF-like using HMAC-SHA256
    // salt = random 16 bytes
    var salt = crypto.randomBytes(16);

    // auth_info
    var authInfo = Buffer.from('Content-Encoding: auth\0');
    var prk = crypto.createHmac('sha256', clientAuth).update(sharedSecret).digest();
    var prkExpand = Buffer.concat([prk, authInfo, Buffer.from([1])]);
    var ikm = crypto.createHmac('sha256', salt).update(prkExpand).digest();

    // keyInfo and nonceInfo
    var keyInfo = Buffer.concat([Buffer.from('Content-Encoding: aesgcm\0'), Buffer.from([0]), clientPubKey, serverPubRaw]);
    var nonceInfo = Buffer.concat([Buffer.from('Content-Encoding: nonce\0'), Buffer.from([0]), clientPubKey, serverPubRaw]);

    function hkdfExpand(prk, info, len) {
        return crypto.createHmac('sha256', prk).update(Buffer.concat([info, Buffer.from([1])])).digest().slice(0, len);
    }

    var contentEncKey = hkdfExpand(ikm, keyInfo, 16);
    var nonce = hkdfExpand(ikm, nonceInfo, 12);

    // Pad payload: 2 bytes padding + content
    var payloadBuf = Buffer.from(payload, 'utf8');
    var padLen = 0;
    var padded = Buffer.concat([Buffer.alloc(2, 0), payloadBuf]); // 2 bytes zero padding

    // Encrypt AES-GCM
    var cipher = crypto.createCipheriv('aes-128-gcm', contentEncKey, nonce);
    var enc1 = cipher.update(padded);
    var enc2 = cipher.final();
    var tag = cipher.getAuthTag();
    var ciphertext = Buffer.concat([enc1, enc2, tag]);

    return { salt, serverPubRaw, ciphertext };
}

// ── Send one push ──
function sendPush(sub, payload) {
    return new Promise(function(resolve) {
        try {
            var parsedUrl = url_mod.parse(sub.endpoint);
            var audience = parsedUrl.protocol + '//' + parsedUrl.host;
            var jwt = makeVapidJwt(audience);
            var vapidPub = VAPID_PUBLIC;

            var enc = encryptPayload(sub, JSON.stringify(payload));
            if (!enc) { resolve(false); return; }

            var headers = {
                'Content-Type': 'application/octet-stream',
                'Content-Encoding': 'aesgcm',
                'Encryption': 'salt=' + b64u(enc.salt),
                'Crypto-Key': 'dh=' + b64u(enc.serverPubRaw) + ';p256ecdsa=' + vapidPub,
                'Authorization': 'WebPush ' + jwt,
                'TTL': '86400',
                'Content-Length': enc.ciphertext.length
            };

            var mod = parsedUrl.protocol === 'https:' ? https : http;
            var req = mod.request({
                hostname: parsedUrl.hostname,
                port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
                path: parsedUrl.path,
                method: 'POST',
                headers: headers
            }, function(res) {
                if (res.statusCode === 410 || res.statusCode === 404) {
                    removeSub(sub.endpoint);
                }
                resolve(res.statusCode < 300);
            });
            req.on('error', function() { resolve(false); });
            req.setTimeout(8000, function() { req.destroy();
                resolve(false); });
            req.write(enc.ciphertext);
            req.end();
        } catch (e) {
            console.warn('[push] Error:', e.message);
            resolve(false);
        }
    });
}

// ── Notify user (send to all their subscriptions) ──
function notifyUser(userName, payload) {
    var userSubs = getSubsForUser(userName);
    userSubs.forEach(function(sub) { sendPush(sub, payload); });
}

// ── Notify all except sender ──
function notifyAllExcept(senderName, payload) {
    Object.keys(subs).forEach(function(name) {
        if (name !== senderName) notifyUser(name, payload);
    });
}

module.exports = { addSub, removeSub, getSubsForUser, getAllSubs, notifyUser, notifyAllExcept, VAPID_PUBLIC };
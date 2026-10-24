'use strict';

const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const { Room } = require('./game');

const PORT = process.env.PORT || 3000;
const app = express();
const server = http.createServer(app);
const io = new Server(server, { pingInterval: 20000, pingTimeout: 20000 });

// html/js/css her seferinde ETag ile doğrulanır: yeni sürüm yayınlanınca tarayıcı eski app.js'i kullanmasın
const staticOpts = { setHeaders: (res, file) => res.setHeader('Cache-Control', /\.(jpe?g|png|svg)$/.test(file) ? 'public, max-age=86400' : 'no-cache') };
app.use(express.static(path.join(__dirname, '..', 'public'), staticOpts));
app.use('/demo', express.static(path.join(__dirname, '..', 'demo'), staticOpts));
const { ROLES, TEAM_NAME, usesFor } = require('./roles');
app.get('/roles.json', (req, res) => res.json(Object.entries(ROLES).map(([key, r]) => ({
  key, name: r.name, team: r.team, teamName: TEAM_NAME[r.team], desc: r.desc, verb: r.verb, color: r.color,
  uses: [5, 9, 11].map(n => { const u = usesFor(key, n); return u === Infinity ? 'sınırsız' : u; }),
}))));
// Sesli sohbet için ICE sunucuları. TURN ortam değişkenleriyle eklenir (bazı ağlarda gerekli).
app.get('/ice.json', (req, res) => {
  const ice = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
  if (process.env.TURN_URL) ice.push({ urls: process.env.TURN_URL.split(',').map(s => s.trim()), username: process.env.TURN_USERNAME || '', credential: process.env.TURN_CREDENTIAL || '' });
  res.json(ice);
});
app.get('/health', (req, res) => res.json({ ok: true, rooms: rooms.size }));

const rooms = new Map();
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
function newCode() {
  let c;
  do { c = Array.from({ length: 4 }, () => LETTERS[Math.floor(Math.random() * LETTERS.length)]).join(''); } while (rooms.has(c));
  return c;
}

// Her değişiklikte odadaki herkese kendi görünümünü gönder
function broadcast(room) {
  for (const p of room.players) {
    if (p.isBot || !p.socketId) continue;
    const s = io.sockets.sockets.get(p.socketId);
    if (s) s.emit('state', room.viewFor(p));
  }
}

function createRoom() {
  const code = newCode();
  const room = new Room(code, r => broadcast(r));
  rooms.set(code, room);
  return room;
}

function attach(socket, room, player) {
  // aynı oyuncu başka sekmeden bağlanırsa eskisini düşür
  if (player.socketId && player.socketId !== socket.id) {
    const old = io.sockets.sockets.get(player.socketId);
    if (old) { old.emit('kicked', 'Bu oyuncu başka bir sekmeden bağlandı.'); old.data = {}; }
  }
  socket.data = { code: room.code, pid: player.id };
  player.socketId = socket.id;
  player.connected = true;
  player.lastSeen = Date.now();
  socket.join(room.code);
  room.changed();
  if (room.phase === 'night') room.checkNightDone();
}

function ctx(socket) {
  const { code, pid } = socket.data || {};
  const room = code && rooms.get(code);
  const player = room && room.byId(pid);
  return player ? { room, player } : null;
}

io.on('connection', socket => {
  socket.on('room:create', ({ name } = {}, ack = () => {}) => {
    const room = createRoom();
    const { player, error } = room.addPlayer(name);
    if (error) return ack({ error });
    attach(socket, room, player);
    ack({ code: room.code, token: player.token });
  });

  socket.on('room:join', ({ code, name } = {}, ack = () => {}) => {
    const room = rooms.get(String(code || '').toUpperCase().trim());
    if (!room) return ack({ error: 'Bu kodla bir oda bulunamadı.' });
    const { player, error } = room.addPlayer(name);
    if (error) return ack({ error });
    attach(socket, room, player);
    ack({ code: room.code, token: player.token });
  });

  socket.on('room:resume', ({ code, token } = {}, ack = () => {}) => {
    const room = rooms.get(String(code || '').toUpperCase());
    const player = room && room.byToken(token);
    if (!player) return ack({ error: 'Oturum bulunamadı.' });
    attach(socket, room, player);
    ack({ code: room.code, token: player.token });
  });

  socket.on('room:leave', () => {
    const c = ctx(socket); if (!c) return;
    const { room, player } = c;
    socket.leave(room.code); socket.data = {};
    player.socketId = null; player.connected = false;
    if (room.phase === 'lobby') room.removePlayer(player.id); else room.changed();
  });

  const on = (ev, fn) => socket.on(ev, (data = {}) => { const c = ctx(socket); if (c) fn(c.room, c.player, data || {}); });
  on('lobby:settings', (room, p, d) => room.setSettings(p.id, d));
  on('lobby:addBot', (room, p) => { if (p.id === room.hostId) room.addBot(); });
  on('lobby:removeBot', (room, p, d) => { const b = room.byId(Number(d.id)); if (p.id === room.hostId && b && b.isBot) room.removePlayer(b.id); });
  on('lobby:start', (room, p) => room.start(p.id));
  on('night:act', (room, p, d) => room.submitAct(p, d.kind, d.targets));
  on('night:pass', (room, p) => room.pass(p));
  on('analyst:report', (room, p) => room.openReport(p));
  on('vote', (room, p, d) => room.vote(p, d.target));
  on('po:veto', (room, p) => room.veto(p));
  on('chat', (room, p, d) => room.say(p, d.text));
  // sesli sohbet: katılım, WebRTC sinyal aktarımı ve konuşma göstergesi
  on('voice:on', (room, p, d) => { p.voice = !!d.on && !p.isBot; if (!p.voice) p.talking = false; room.changed(); });
  on('rtc:signal', (room, p, d) => {
    const to = room.byId(Number(d.to));
    if (!to || to === p || !to.socketId || !p.voice || !d.data || JSON.stringify(d.data).length > 20000) return;
    const s = io.sockets.sockets.get(to.socketId);
    if (s) s.emit('rtc:signal', { from: p.id, data: d.data });
  });
  on('voice:talk', (room, p, d) => {
    const on = !!d.on && room.canTalk(p);
    if (on === !!p.talking) return;
    p.talking = on;
    io.to(room.code).emit('voice:talk', { id: p.id, on });
  });
  on('game:lobby', (room, p) => room.backToLobby(p.id));

  socket.on('disconnect', () => {
    const c = ctx(socket); if (!c) return;
    const { room, player } = c;
    if (player.socketId !== socket.id) return;
    player.socketId = null; player.connected = false; player.lastSeen = Date.now();
    player.voice = false; player.talking = false;
    room.changed();
    if (room.phase === 'night') room.checkNightDone();
  });
});

// Boş odaları temizle; lobide uzun süre bağlı olmayanları çıkar
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    const humans = room.humans();
    if (room.phase === 'lobby') for (const p of humans) if (!p.connected && now - p.lastSeen > 60000) room.removePlayer(p.id);
    const anyone = room.humans().some(p => p.connected || now - p.lastSeen < 10 * 60000);
    if (!anyone) { room.destroy(); rooms.delete(code); }
  }
}, 15000).unref();

server.listen(PORT, () => console.log(`Prod'da Hain Var http://localhost:${PORT}`));

module.exports = { server, rooms };

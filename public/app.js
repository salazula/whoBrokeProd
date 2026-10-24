(() => {
'use strict';
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const wait = ms => new Promise(r => setTimeout(r, ms));
const socket = io();

// Türkçe ek (sunucudakiyle aynı)
function sfx(name, t){
  const v = (name.toLocaleLowerCase('tr').match(/[aeıioöuü]/g) || ['e']).pop();
  const endsV = /[aeıioöuüAEIİOÖUÜ]$/.test(name);
  const four = { a:'ı', ı:'ı', o:'u', u:'u', e:'i', i:'i', ö:'ü', ü:'ü' }[v];
  const two = 'aıou'.includes(v) ? 'a' : 'e';
  if (t === 'in') return "'" + (endsV ? 'n' : '') + four + 'n';
  if (t === 'i') return "'" + (endsV ? 'y' : '') + four;
  return "'" + (endsV ? 'y' : '') + two;
}

const store = {
  get(k){ try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } },
  set(k, v){ try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k){ try { localStorage.removeItem(k); } catch {} },
};

const COLORS = ['#2440C9','#C2410C','#4D7C0F','#9333EA','#B91C1C','#A21CAF','#0E7490','#B45309','#0F766E','#BE185D','#4338CA','#15803D'];
const HAIR = ['#2B1A10','#6B3A1E','#111111','#C98B3A','#2A1A10','#3A2416','#1A1A1A','#8A4B22'];
const NEON = ['#3FCDB8','#FF8FB1','#A99CFF','#7FE0CF','#F2C94C','#7FA2FF'];
const look = p => ({ shirt: COLORS[p.seat % COLORS.length], hair: HAIR[p.seat % HAIR.length], neon: NEON[p.seat % NEON.length] });
const TEAM = { town:'Ekip', evil:'Sabotaj', neutral:'Tarafsız' };

let S = null, prev = null, skew = 0;
let ui = { kind:null, targets:[], key:'' };

/* ---------- giriş ---------- */
const params = new URLSearchParams(location.search);
const urlCode = (params.get('oda') || '').toUpperCase();
$('#nameIn').value = store.get('phv-name') || '';
if (urlCode) $('#codeIn').value = urlCode;
function show(id){ for (const s of ['landing','lobby','game']) $('#' + s).hidden = s !== id; }
function landErr(t){ $('#landErr').textContent = t || ''; }
function myName(){ const n = $('#nameIn').value.trim(); if (!n){ landErr('Önce adını yaz.'); $('#nameIn').focus(); return null; } store.set('phv-name', n); return n; }
function entered(res){
  if (res.error) return landErr(res.error);
  store.set('phv', { code: res.code, token: res.token });
  history.replaceState(null, '', '?oda=' + res.code);
}
$('#createBtn').onclick = () => { const name = myName(); if (name) socket.emit('room:create', { name }, entered); };
$('#joinBtn').onclick = () => {
  const name = myName(); if (!name) return;
  const code = $('#codeIn').value.trim().toUpperCase();
  if (code.length !== 4) return landErr('Oda kodu 4 harften oluşur.');
  socket.emit('room:join', { code, name }, entered);
};
$('#codeIn').addEventListener('keydown', e => { if (e.key === 'Enter') $('#joinBtn').click(); });
$('#nameIn').addEventListener('keydown', e => { if (e.key === 'Enter') (urlCode ? $('#joinBtn') : $('#createBtn')).click(); });

socket.on('connect', () => {
  const s = store.get('phv');
  if (s && (!urlCode || urlCode === s.code)) {
    socket.emit('room:resume', s, res => { if (res.error){ store.del('phv'); if (!S) show('landing'); } });
  } else if (!S) show('landing');
});
socket.on('disconnect', () => toast('Bağlantı koptu, yeniden bağlanıyor…'));
socket.on('kicked', msg => { toast(msg); S = null; show('landing'); });
socket.on('state', st => { prev = S; S = st; skew = st.now - Date.now(); render(); });
Voice.init(socket, () => S, () => renderVoice());

let toastT;
function toast(t){ const el = $('#toast'); el.textContent = t; el.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('show'), 2600); }

/* ---------- ortak ---------- */
const me = () => S.players.find(p => p.id === S.meId);
const P = id => S.players.find(p => p.id === id);
const isHost = () => S.hostId === S.meId;
const avatar = p => `<span class="av" style="background:${look(p).shirt}">${esc(p.name[0])}</span>`;

function render(){
  if (S.phase === 'lobby'){ show('lobby'); renderLobby(); $('#endBox').hidden = true; }
  else { show('game'); renderGame(); }
}

/* ---------- lobi ---------- */
let ROLE_INFO = null;
fetch('roles.json').then(r => r.json()).then(r => { ROLE_INFO = r; if (S && S.phase === 'lobby') renderLobby(); }).catch(() => {});
$('#copyBtn').onclick = () => {
  const v = $('#inviteIn').value;
  navigator.clipboard.writeText(v).then(() => toast('Davet linki kopyalandı.'), () => { $('#inviteIn').select(); toast('Linki seçtim, kopyalayabilirsin.'); });
};
$('#addBotBtn').onclick = () => socket.emit('lobby:addBot');
$('#startBtn').onclick = () => socket.emit('lobby:start');
$('#leaveBtn').onclick = () => { socket.emit('room:leave'); store.del('phv'); S = null; history.replaceState(null, '', location.pathname); show('landing'); };

function renderLobby(){
  const host = isHost();
  $('#lobbyCode').textContent = S.code;
  $('#lobbyCount').textContent = `${S.players.length}/${S.maxPlayers} oyuncu`;
  $('#inviteIn').value = `${location.origin}${location.pathname}?oda=${S.code}`;
  $('#plist').innerHTML = S.players.map(p => `<li class="${p.connected ? '' : 'off'}">${avatar(p)}<span class="nm">${esc(p.name)}</span>${p.isHost ? '<span class="tag host">kurucu</span>' : ''}${p.isBot ? '<span class="tag">bot</span>' : ''}${p.id === S.meId ? '<span class="tag">sen</span>' : ''}${!p.connected && !p.isBot ? '<span class="tag">bağlı değil</span>' : ''}${host && p.isBot ? `<button type="button" data-rm="${p.id}" aria-label="${esc(p.name)} botunu çıkar">×</button>` : ''}</li>`).join('');
  $('#plist').querySelectorAll('[data-rm]').forEach(b => b.onclick = () => socket.emit('lobby:removeBot', { id: +b.dataset.rm }));
  $('#hostRow').hidden = !host;
  $('#addBotBtn').disabled = S.players.length >= S.maxPlayers;
  $('#startBtn').hidden = !host;
  $('#startBtn').disabled = S.players.length < S.minPlayers;
  $('#lobbyErr').textContent = S.error || (host ? (S.players.length < S.minPlayers ? `Başlamak için en az ${S.minPlayers} oyuncu gerekli.` : '') : 'Oyunu oda kurucusu başlatacak.');
  renderSettings(host);
  renderChat($('#lobbyChat'));
}
function renderSettings(host){
  const st = S.settings; const box = $('#settingsBox');
  const dis = host ? '' : 'disabled';
  let html = `<h3>Oyun ayarları${host ? '' : ' · sadece kurucu değiştirebilir'}</h3>
    <div class="seg" role="group" aria-label="Rol dağıtımı"><button type="button" data-mode="auto" aria-pressed="${st.mode === 'auto'}" ${dis}>Otomatik</button><button type="button" data-mode="custom" aria-pressed="${st.mode === 'custom'}" ${dis}>Özel</button></div>`;
  if (st.mode === 'auto'){
    html += `<p class="note">Roller oyuncu sayısına göre dağıtılır: 5-6 kişide 1, 7-10 kişide 2, 11-12 kişide 3 sabotajcı. 8 kişiden itibaren tarafsız roller de girer.</p>
      <label class="check"><input type="checkbox" id="optTraitor" ${st.traitor ? 'checked' : ''} ${dis}> Hain olsun (bir Ekip rolü gizlice sabotajcı olur, Sosyal Mühendis'in yerini alır)</label>
      <label class="check"><input type="checkbox" id="optBomb" ${st.logicBomb ? 'checked' : ''} ${dis}> Logic Bomb oyunda olabilir</label>`;
  } else {
    const keys = ROLE_INFO ? [...ROLE_INFO.map(r => [r.key, r.name, r.team]), ['traitor', 'Hain (rastgele Ekip rolü)', 'evil']] : [];
    const total = Object.entries(st.counts || {}).filter(([k]) => k !== 'traitor').reduce((a, [, v]) => a + v, 0);
    html += `<p class="note">Her rolden kaç tane olacağını seç. Toplam ${total}/${S.players.length}. Hain, seçilen Ekip rollerinden birini gizlice sabotajcı yapar ve toplama eklenmez.</p>
      <div class="counts">${keys.map(([k, n, t]) => `<div class="cnt"><span class="nm">${esc(n)}<small class="t-${t}">${TEAM[t]}</small></span>${host ? `<button type="button" data-dec="${k}" aria-label="${esc(n)} azalt">−</button>` : ''}<b>${(st.counts || {})[k] || 0}</b>${host ? `<button type="button" data-inc="${k}" aria-label="${esc(n)} artır">+</button>` : ''}</div>`).join('')}</div>`;
  }
  box.innerHTML = html;
  if (!host) return;
  box.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => socket.emit('lobby:settings', { mode: b.dataset.mode }));
  const t = $('#optTraitor'); if (t) t.onchange = () => socket.emit('lobby:settings', { traitor: t.checked });
  const bo = $('#optBomb'); if (bo) bo.onchange = () => socket.emit('lobby:settings', { logicBomb: bo.checked });
  const bump = (k, d) => { const c = { ...(st.counts || {}) }; c[k] = Math.max(0, (c[k] || 0) + d); socket.emit('lobby:settings', { counts: c }); };
  box.querySelectorAll('[data-inc]').forEach(b => b.onclick = () => bump(b.dataset.inc, 1));
  box.querySelectorAll('[data-dec]').forEach(b => b.onclick = () => bump(b.dataset.dec, -1));
}

/* ---------- sohbet ---------- */
function chatMode(){
  if (!S) return null;
  const m = me();
  if (S.phase === 'lobby' || S.phase === 'over') return 'standup';
  if (!m.alive) return 'mezarlik';
  if (['meeting','veto','verdict','morning'].includes(S.phase)) return 'standup';
  if (S.phase === 'night' && S.mine && S.mine.team === 'evil') return 'sabotaj';
  return null;
}
let chatSig = {};
function renderChat(el){
  const sig = S.chat.length ? S.chat[S.chat.length - 1].id + ':' + S.chat.length : '0';
  if (chatSig[el.id] === sig) return;
  chatSig[el.id] = sig;
  const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  el.innerHTML = S.chat.map(m => {
    if (m.ch === 'system') return `<div class="msg sys"><span class="tx">${esc(m.text)}</span></div>`;
    const p = P(m.from); if (!p) return '';
    const ch = m.ch === 'standup' ? '' : `<span class="ch ${m.ch}">#${m.ch === 'mezarlik' ? 'mezarlık' : m.ch}</span>`;
    return `<div class="msg">${avatar(p)}<span class="tx">${ch}<b>${esc(p.name)}</b>${esc(m.text)}</span></div>`;
  }).join('');
  if (atBottom || !el.dataset.init){ el.scrollTop = el.scrollHeight; el.dataset.init = 1; }
}
function sendChat(input){ const t = input.value.trim(); if (!t) return; socket.emit('chat', { text: t }); input.value = ''; }
$('#lobbyChatForm').onsubmit = e => { e.preventDefault(); sendChat($('#lobbyChatIn')); };
$('#chatForm').onsubmit = e => { e.preventDefault(); if (chatMode()) sendChat($('#chatIn')); };

/* ---------- sahne ---------- */
function officeSVG(p){
  const o = look(p);
  return `<svg class="osvg" viewBox="0 0 300 240" role="img" aria-label="${esc(p.name)} ofisi">
  <polygon class="floor" points="150,110 270,170 150,230 30,170"/>
  <polyline points="90,140 210,200" stroke="#000" stroke-opacity=".12" fill="none"/><polyline points="210,140 90,200" stroke="#000" stroke-opacity=".12" fill="none"/>
  <polygon class="wallL" points="30,170 150,110 150,20 30,80"/><polygon class="wallR" points="150,110 270,170 270,80 150,20"/>
  <polygon class="capL" points="30,80 150,20 150,13 30,73"/><polygon class="capR" points="150,20 270,80 270,73 150,13"/>
  <polygon class="capL" points="30,170 30,80 30,73 24,76 24,167"/><polygon class="capR" points="270,170 270,80 270,73 276,76 276,167"/>
  <polygon points="120,80 84,98 84,63 120,45" fill="#E8ECF7" stroke="#0A0C1C" stroke-width="1.5"/>
  <polygon points="114,58 105.6,62.2 105.6,56.2 114,52" fill="#F2C94C"/><polygon points="99.6,75.2 91.2,79.4 91.2,73.4 99.6,69.2" fill="#FF8FB1"/><polygon points="114,72 105.6,76.2 105.6,70.2 114,66" fill="#7FE0CF"/>
  <circle cx="58" cy="78" r="8" fill="#E8ECF7" stroke="#0A0C1C" stroke-width="1.5"/><polyline points="58,78 58,73 61,79" stroke="#0A0C1C" stroke-width="1.3" fill="none"/>
  <polygon points="186,48 222,66 222,54 186,36" fill="${o.neon}" opacity=".9"/>
  <polygon points="174,94 246,130 216,145 144,109" fill="#8A6440"/><polygon points="144,109 216,145 216,179 144,143" fill="#5E4229"/><polygon points="246,130 216,145 216,179 246,164" fill="#6E4E31"/>
  <polyline points="195.6,101 194.4,108" stroke="#0A0C1C" stroke-width="3"/><polyline points="225.6,116 224.4,123" stroke="#0A0C1C" stroke-width="3"/>
  <polygon points="183.6,95.2 207.6,107.2 207.6,77.2 183.6,65.2" fill="#0A0C1C"/><polygon class="scr" points="185.6,94.2 205.6,104.2 205.6,80.2 185.6,70.2"/>
  <polygon points="213.6,110.2 237.6,122.2 237.6,92.2 213.6,80.2" fill="#0A0C1C"/><polygon class="scr" points="215.6,109.2 235.6,119.2 235.6,95.2 215.6,85.2"/>
  <g stroke-width="2" stroke-linecap="round"><polyline class="code" points="188,78 198,83"/><polyline class="code b" points="188,83 202,90"/><polyline class="code" points="188,88 196,92"/><polyline class="code b" points="218,93 230,99"/><polyline class="code" points="218,98 226,102"/><polyline class="code b" points="218,103 232,110"/></g>
  <polygon points="58,146 74,146 72,162 60,162" fill="#B5643C"/><ellipse cx="60" cy="134" rx="5" ry="12" fill="#2F9E6E" transform="rotate(-25 60 134)"/><ellipse cx="72" cy="134" rx="5" ry="12" fill="#3FBF85" transform="rotate(25 72 134)"/><ellipse cx="66" cy="130" rx="5" ry="13" fill="#36AE79"/>
  <ellipse cx="184" cy="182" rx="15" ry="5" fill="#0A0C1C" opacity=".6"/><polyline points="184,163 184,180" stroke="#0A0C1C" stroke-width="3"/>
  <g class="person"><rect x="171" y="131" width="26" height="30" rx="11" fill="${o.shirt}"/><circle cx="184" cy="122" r="10.5" fill="#E9B98F"/><path d="M173.5 121 a10.5 10.5 0 0 1 21 0 q-10.5 4 -21 0z" fill="${o.hair}"/></g>
  <rect x="172" y="146" width="24" height="18" rx="4" fill="#1A1E3E"/>
  <g class="tape"><polygon points="40,150 262,120 262,132 40,162" fill="#F2C94C" stroke="#0A0C1C"/><text x="151" y="146" text-anchor="middle" transform="rotate(-7.7 151 146)" font-family="JetBrains Mono, monospace" font-size="10" font-weight="600" fill="#0A0C1C" letter-spacing="2">OFFLINE · OFFLINE · OFFLINE</text></g>
</svg>`;
}
$('#tablewrap').innerHTML = `<svg viewBox="0 0 460 240" aria-label="Toplantı masası" role="img">
  <ellipse class="rug" cx="230" cy="125" rx="215" ry="105"/><ellipse class="rugline" cx="230" cy="125" rx="200" ry="95" fill="none" stroke-width="2" stroke-dasharray="6 6"/>
  <ellipse cx="230" cy="131" rx="150" ry="58" fill="#000" opacity=".25"/><ellipse cx="230" cy="122" rx="150" ry="58" fill="#5E4229"/><ellipse cx="230" cy="113" rx="150" ry="58" fill="#8A6440"/>
  <ellipse cx="230" cy="113" rx="136" ry="50" fill="none" stroke="#A47A50" stroke-width="2"/><ellipse cx="230" cy="113" rx="20" ry="9" fill="#1A1E3E"/><ellipse cx="230" cy="111" rx="14" ry="6" fill="#3FCDB8"/>
</svg>`;

const stage = $('#stage'), fx = $('#fx'), cap = $('#caption');
const offices = new Map();
const holdDead = new Set(); // ölüm animasyonu bitene kadar ofisi canlı göster
let officeKey = '';
function caption(html, color){ cap.style.setProperty('--cap', color || '#A99CFF'); cap.innerHTML = html; cap.classList.add('show'); }
function hideCaption(){ cap.classList.remove('show'); }
const anim = (node, frames, opts) => node.animate(frames, { fill:'forwards', easing:'cubic-bezier(.3,.7,.3,1)', ...opts }).finished.catch(() => {});
function el(html, x, y, cls = ''){ const d = document.createElement('div'); d.className = 'fxel ' + cls; d.innerHTML = html; d.style.left = x + 'px'; d.style.top = y + 'px'; fx.appendChild(d); return d; }
function clearFx(){ fx.innerHTML = ''; }
function pt(id, x, y){ const o = offices.get(id); const s = stage.getBoundingClientRect(), r = o.querySelector('.osvg').getBoundingClientRect(); return { x: r.left - s.left + x/300*r.width, y: r.top - s.top + y/240*r.height, s: r.width/300 }; }

function buildOffices(){
  const key = S.players.map(p => p.id).join(',');
  if (key === officeKey) return;
  officeKey = key;
  const wrap = $('#offices'); wrap.innerHTML = ''; offices.clear();
  const n = S.players.length;
  stage.style.setProperty('--ow', n <= 6 ? '18%' : n <= 9 ? '15.5%' : '13.5%');
  S.players.forEach((p, i) => {
    const a = -Math.PI/2 + i * 2 * Math.PI / n;
    const d = document.createElement('div'); d.className = 'office';
    d.style.left = (50 + 39 * Math.cos(a)) + '%'; d.style.top = (50 + 35 * Math.sin(a)) + '%';
    d.innerHTML = `<span class="sign"></span>${officeSVG(p)}`;
    d.onclick = () => onPick(p.id);
    wrap.appendChild(d); offices.set(p.id, d);
  });
}
function signOf(p){
  const tags = [];
  let color = '';
  if (!p.alive){ tags.push(`<i style="color:#FF6E98">${esc(p.role || 'düştü')}</i>`); color = '#FF6E98'; }
  else if (p.id === S.meId) tags.push('<i>sen</i>');
  if (p.alive && p.mate){ tags.push('<i style="color:#FF6E98">ortak</i>'); color = '#FF6E98'; }
  if (p.alive && p.role === 'Product Owner' && p.id !== S.meId){ tags.push('<i style="color:#F2B850">PO</i>'); }
  if (!p.connected && !p.isBot) tags.push('<i>bağlı değil</i>');
  return { html: `<span class="dot" style="background:${color || '#566078'}"></span>${esc(p.name)}${tags.length ? ' ' + tags.join(' ') : ''}`, color };
}
function updateOffices(){
  for (const p of S.players){
    const o = offices.get(p.id); if (!o) continue;
    if (!holdDead.has(p.id)) o.classList.toggle('dead', !p.alive);
    o.classList.toggle('offline', !p.connected && !p.isBot);
    const s = o.querySelector('.sign'); const sg = signOf(p);
    if (!o.dataset.fxsign){ s.innerHTML = sg.html; s.style.borderColor = sg.color; }
  }
}
function fxSign(id, tag, color){ const o = offices.get(id); if (!o) return; const p = P(id); o.dataset.fxsign = 1; const s = o.querySelector('.sign'); s.innerHTML = `<span class="dot" style="background:${color}"></span>${esc(p.name)} <i style="color:${color}">${tag}</i>`; s.style.borderColor = color; }
function clearFxSigns(){ offices.forEach(o => { delete o.dataset.fxsign; o.classList.remove('red','blocked','glitch','sel','pick'); }); }

function seatPos(i, n){ const a = Math.PI/2 + i*2*Math.PI/n; return { x: 50 + 15*Math.cos(a), y: 52 + 10.5*Math.sin(a) }; }
async function toTable(animate = true){
  stage.querySelectorAll('.avatar').forEach(a => a.remove());
  const ps = S.players.filter(p => p.alive); const n = Math.max(ps.length, 3);
  const sr = stage.getBoundingClientRect();
  ps.forEach((p, i) => {
    const o = pt(p.id, 184, 125);
    const a = document.createElement('div'); a.className = 'avatar'; a.dataset.id = p.id; a.textContent = p.name[0]; a.style.background = look(p).shirt;
    a.title = p.name; a.onclick = () => onPick(p.id);
    const s = seatPos(i, n);
    if (animate){ a.style.left = (o.x / sr.width * 100) + '%'; a.style.top = (o.y / sr.height * 100) + '%'; requestAnimationFrame(() => requestAnimationFrame(() => { a.style.left = s.x + '%'; a.style.top = s.y + '%'; })); }
    else { a.style.left = s.x + '%'; a.style.top = s.y + '%'; }
    stage.appendChild(a); offices.get(p.id).classList.add('away');
  });
  if (animate) await wait(1400);
}
function leaveTable(){ stage.querySelectorAll('.avatar').forEach(a => a.remove()); offices.forEach(o => o.classList.remove('away')); }

/* ---------- oyun ekranı ---------- */
const PHASE = {
  night:   d => [`Gece ${d}`, 'Herkes ofisinde'],
  morning: d => [`Gün ${d} · sabah`, 'Olay raporu'],
  meeting: d => [`Gün ${d} · standup ve oylama`, 'Konuşurken oy verebilirsin'],
  veto:    d => [`Gün ${d} · karar`, 'Veto penceresi açık'],
  verdict: d => [`Gün ${d} · karar`, 'Sonuçlar açıklandı'],
  over:    () => ['Oyun bitti', ''],
};
function renderGame(){
  buildOffices();
  const [nm, sub] = PHASE[S.phase](S.day);
  $('#phName').textContent = nm; $('#phSub').textContent = sub;
  $('#codeTag').textContent = 'ODA ' + S.code;
  const key = S.phase + ':' + S.day;
  if (key !== ui.key){ ui = { kind:null, targets:[], key }; transition(prev && prev.phase !== 'lobby' ? prev : null); }
  updateOffices();
  renderRole(); renderAct(); renderLog(); renderChat($('#chat')); refreshChatInput();
  Voice.sync(); renderVoice();
  if (prev && S.mine && S.mine.report && !(prev.mine && prev.mine.report && prev.mine.report.day === S.mine.report.day)) reportAnim(S.mine.report);
}

async function transition(old){
  const ph = S.phase;
  if (ph === 'night'){
    stage.classList.remove('day'); clearFx(); clearFxSigns(); leaveTable(); $('#endBox').hidden = true;
    caption(`Gece ${S.day}. Ofislerin ışıkları kısıldı.`, '#A99CFF');
  } else if (ph === 'morning'){
    stage.classList.add('day'); clearFx(); clearFxSigns(); hideCaption();
    if (old) await morningAnim(); else updateOffices();
  } else if (ph === 'meeting'){
    stage.classList.add('day'); clearFx(); clearFxSigns();
    await toTable(!!old && old.phase === 'morning');
    caption(me().alive ? 'Herkes masada. Tartış ve istediğin an oy ver.' : 'Toplantıyı izliyorsun. Ölüler konuşamaz.', '#3FCDB8');
  } else if (ph === 'veto'){
    stage.classList.add('day');
    if (!stage.querySelector('.avatar')) await toTable(false);
    const out = P(S.verdict.outId);
    caption(`<b>${esc(out.name)}</b> repodan atılmak üzere. Karar birkaç saniye içinde kesinleşecek.`, '#FF6E98');
  } else if (ph === 'verdict'){
    stage.classList.add('day');
    if (!stage.querySelector('.avatar')) await toTable(false);
    await verdictAnim(!!old);
  } else if (ph === 'over'){
    stage.classList.add('day');
    showEnd();
  }
}

async function morningAnim(){
  const m = S.morning || { deaths: [] };
  m.deaths.forEach(d => { holdDead.add(d.id); const o = offices.get(d.id); if (o) o.classList.remove('dead'); });
  for (const d of m.deaths){
    const o = offices.get(d.id); if (!o) { holdDead.delete(d.id); continue; }
    const p = pt(d.id, 150, 10);
    const siren = el('', p.x - 14, p.y - 30); Object.assign(siren.style, { width:'28px', height:'16px', borderRadius:'14px 14px 4px 4px', background:'#FF3B6B', boxShadow:'0 0 30px 12px rgba(255,59,107,.7)' });
    if (d.cause === 'bomb'){ o.classList.add('glitch'); o.animate([{ transform:'translate(-50%,-50%)' }, { transform:'translate(calc(-50% - 6px),-50%)' }, { transform:'translate(calc(-50% + 6px),-50%)' }, { transform:'translate(-50%,-50%)' }], { duration:300, iterations:3 }); }
    await anim(siren, [{ opacity:1 }, { opacity:.2 }, { opacity:1 }, { opacity:.2 }, { opacity:1 }, { opacity:0 }], { duration:1300 });
    holdDead.delete(d.id); o.classList.add('dead'); o.classList.remove('glitch');
    caption(`INCIDENT · <b>${esc(P(d.id).name)}</b> prod'dan düştü. Gerçek rolü: ${esc(d.role)}.`, '#FF6E98');
    await wait(1200);
  }
  if (!m.deaths.length){
    if (m.saved){
      const r = stage.getBoundingClientRect(); const sz = Math.min(r.width, r.height) * .4;
      const ring = el('', r.width/2 - sz/2, r.height/2 - sz/2); Object.assign(ring.style, { width:sz+'px', height:sz+'px', borderRadius:'50%', border:'4px solid #3FCDB8', boxShadow:'0 0 40px rgba(63,205,184,.8)' });
      anim(ring, [{ transform:'scale(.3)', opacity:0 }, { transform:'scale(1)', opacity:1, offset:.5 }, { transform:'scale(1.25)', opacity:0 }], { duration:1200 });
      caption('Gece bir saldırı engellendi. Kimse düşmedi.', '#3FCDB8');
    } else caption('Sakin bir gece. Kimse düşmedi.', '#3FCDB8');
  }
  updateOffices();
}

async function verdictAnim(animate){
  const v = S.verdict; if (!v) return;
  if (v.vetoed){
    const r = stage.getBoundingClientRect();
    const s = el(`<div style="font-family:var(--display);font-weight:800;font-size:clamp(40px,9vw,96px);letter-spacing:.06em;color:#C42656;border:8px solid #C42656;border-radius:14px;padding:0 24px;background:rgba(255,255,255,.8)">VETO</div>`, r.width/2, r.height*0.42);
    await anim(s, [{ transform:'translate(-50%,-50%) scale(3) rotate(-25deg)', opacity:0 }, { transform:'translate(-50%,-50%) scale(1) rotate(-8deg)', opacity:1 }], { duration:500, easing:'cubic-bezier(.6,0,.9,.4)' });
    caption(esc(v.why), '#C42656');
    return;
  }
  if (v.outId){
    const out = P(v.outId);
    caption(`<b>${esc(out.name)}</b> repodan atıldı. Rolü: ${esc(v.outRole)}.`, v.outTeam === 'evil' ? '#FF6E98' : '#3FCDB8');
    const a = stage.querySelector(`.avatar[data-id="${v.outId}"]`);
    if (a && animate) await anim(a, [{ opacity:1, transform:'translate(-50%,-50%) scale(1)' }, { opacity:0, transform:'translate(-50%,-50%) scale(.2) rotate(90deg)' }], { duration:900 });
    else if (a) a.remove();
    updateOffices();
  } else caption(esc(v.why), '#F2C94C');
}

/* ---------- rol kartı ---------- */
function renderRole(){
  const box = $('#roleBox'); const m = S.mine; const p = me();
  if (!m){ box.innerHTML = '<h3>Rolün</h3><p class="note">Bu oyunda rolün yok.</p>'; return; }
  box.className = 'box rolecard ' + m.team;
  const uses = m.maxUses == null ? 'Hak: sınırsız' : `Kalan hak: ${m.uses}/${m.maxUses}`;
  box.innerHTML = `<h3>Rolün</h3><div class="rname">${esc(m.roleName)}</div><span class="team ${m.team}">${TEAM[m.team]}</span><p class="rdesc">${esc(m.desc)}</p>
    ${m.mentor ? `<p class="rdesc">Mentorun: <b>${esc(m.mentor)}</b></p>` : ''}
    ${S.players.some(q => q.mate) ? `<p class="rdesc" style="color:var(--evil)">Ortakların: ${S.players.filter(q => q.mate).map(q => esc(q.name) + (q.alive ? '' : ' (düştü)')).join(', ')}</p>` : ''}
    <span class="uses">${p.alive ? uses : 'Prod\'dan düştün. Oyunu izleyebilirsin, #mezarlık açık.'}</span>`;
}

/* ---------- hamle paneli ---------- */
const pickBtn = (p, pressed, label = '', disabled = false) => `<button type="button" class="pbtn" data-id="${p === 'skip' ? 'skip' : p.id}" aria-pressed="${!!pressed}" ${disabled ? 'disabled' : ''}>${p === 'skip' ? '<span class="nm">Atla</span>' : `${avatar(p)}<span class="nm">${esc(p.name)}</span>`}${label ? `<span class="ct">${label}</span>` : ''}</button>`;
function markPick(ids, color, selected = []){
  offices.forEach((o, id) => { o.classList.toggle('pick', ids.includes(id)); o.classList.toggle('sel', selected.includes(id)); o.style.setProperty('--pickc', color); });
  stage.querySelectorAll('.avatar').forEach(a => { const id = +a.dataset.id; a.classList.toggle('pick', ids.includes(id) && !selected.includes(id)); a.classList.toggle('mine', selected.includes(id)); });
}
function reportButton(){ return S.mine && S.mine.canReport ? `<div class="row2"><button class="btn primary" id="reportBtn" type="button" style="background:#5AAAFF;border-color:#5AAAFF">Oy raporunu aç (Gün ${S.day - (S.phase === 'night' ? 1 : 0)})</button></div>` : ''; }
function reportHtml(){
  const r = S.mine && S.mine.report; if (!r) return '';
  return `<div class="result" style="border-left-color:#5AAAFF"><b>Oy raporu · Gün ${r.day}</b> (sadece sen görüyorsun)</div><div class="picks">${r.votes.map(v => { const a = P(v.voter), t = v.target === 'skip' ? null : P(v.target); return a ? `<div class="pbtn static">${avatar(a)}<span class="nm">${esc(a.name)} → ${t ? '<b>' + esc(t.name) + '</b>' : '<span style="color:var(--muted)">Atla</span>'}</span></div>` : ''; }).join('')}</div>`;
}
function bindReport(){ const b = $('#reportBtn'); if (b) b.onclick = () => socket.emit('analyst:report'); }

// Panel sadece içeriği değiştiyse yeniden çizilir; böylece sık gelen güncellemelerde düğmeler titremez
const actEl = $('#actBox');
const actBox = { set innerHTML(h){ if (h !== actEl._h){ actEl.innerHTML = h; actEl._h = h; } }, querySelectorAll: s => actEl.querySelectorAll(s) };
function renderAct(){
  const box = actBox; const m = S.mine; const p = me();
  markPick([], '#A99CFF');
  if (S.phase === 'night'){
    if (!p.alive){ box.innerHTML = '<h3>Gece</h3><p class="note">Düşenler gece hamle yapamaz.</p>'; return; }
    const opts = m.options.filter(o => !o.instant);
    const extra = reportButton() + reportHtml();
    if (!opts.length){
      const why = m.role === 'po' ? 'Product Owner gece hamle yapmaz. Vetonu oylama sonrasında kullanırsın.' : m.role === 'pm' ? 'Project Manager gece hamle yapmaz. Gündüz herkesi kendinden şüphelendir.' : m.role === 'analyst' ? 'Raporu açmadıysan aşağıdan açabilirsin.' : m.role === 'intern' && m.mentor ? 'Mentorunu seçtin. Bu gece bekliyorsun.' : 'Bu gece yapabileceğin bir hamle yok.';
      box.innerHTML = `<h3>Gece</h3><p class="note">${why}</p>${extra}`; bindReport(); return;
    }
    if (!ui.kind || !opts.some(o => o.kind === ui.kind)) ui.kind = (m.act && opts.some(o => o.kind === m.act.kind)) ? m.act.kind : opts[0].kind;
    const opt = opts.find(o => o.kind === ui.kind);
    const col = opt.kind === 'hack' ? '#FF6E98' : m.color;
    const valid = opt.valid.map(P);
    const done = m.act && !m.act.pass ? m.act : null;
    const tabs = opts.length > 1 ? `<div class="tabs">${opts.map(o => `<button type="button" class="btn" data-kind="${o.kind}" aria-pressed="${o.kind === ui.kind}">${esc(o.verb)}</button>`).join('')}</div>` : '';
    const picks = opt.targets ? `<div class="picks">${valid.map(q => pickBtn(q, ui.targets.includes(q.id))).join('')}</div>` : '';
    const need = opt.targets;
    const ready = ui.targets.length === need;
    const doneTx = done ? `Hamlen kaydedildi: ${esc(opts.find(o => o.kind === done.kind)?.verb || done.kind)}${done.targets.length ? ' → ' + done.targets.map(id => esc(P(id).name)).join(', ') : ''}. Gece bitene kadar değiştirebilirsin.` : m.act && m.act.pass ? 'Bu gece pas geçtin.' : (need === 2 ? 'İki oyuncu seç.' : need ? 'Bir oyuncu seç.' : '') + ' Herkes hamlesini yapınca gece erken biter.';
    box.innerHTML = `<h3>Gece hamlen · ${esc(opt.verb)}</h3>${tabs}${picks}
      <div class="row2"><button class="btn primary" id="confirmNight" type="button" ${ready ? '' : 'disabled'}>${esc(opt.verb)}</button><button class="btn" id="passNight" type="button">Pas geç</button></div>
      <p class="note">${doneTx}</p>${extra}`;
    box.querySelectorAll('[data-kind]').forEach(b => b.onclick = () => { ui.kind = b.dataset.kind; ui.targets = []; renderAct(); });
    box.querySelectorAll('.pbtn').forEach(b => b.onclick = () => onPick(+b.dataset.id));
    $('#confirmNight').onclick = () => { socket.emit('night:act', { kind: opt.kind, targets: ui.targets }); nightAnim(opt.kind, ui.targets.slice()); ui.targets = []; };
    $('#passNight').onclick = () => { ui.targets = []; socket.emit('night:pass'); };
    bindReport();
    if (need) markPick(opt.valid, col, ui.targets);
    return;
  }
  if (S.phase === 'morning'){
    const d = (S.morning && S.morning.deaths) || [];
    box.innerHTML = `<h3>Sabah raporu</h3>${d.length ? d.map(x => `<div class="result evil"><b>${esc(P(x.id).name)}</b> düştü. Rolü: ${esc(x.role)}.</div>`).join('') : `<div class="result town">${S.morning && S.morning.saved ? 'Bir saldırı engellendi, kimse düşmedi.' : 'Kimse düşmedi.'}</div>`}<p class="note">Herkes toplantı masasına geçiyor.</p>${reportButton()}${reportHtml()}`;
    bindReport(); return;
  }
  if (S.phase === 'meeting'){
    const vc = S.voteCount || { voted:0, total:0 };
    if (!p.alive){ box.innerHTML = `<h3>Standup ve oylama</h3><p class="note">Düşenler oy veremez. ${vc.voted}/${vc.total} kişi oy verdi.</p>`; return; }
    const mine = m.myVote;
    const ts = S.players.filter(q => q.alive && q.id !== S.meId);
    box.innerHTML = `<h3>Standup ve oylama · oylar gizli</h3>
      <div class="picks">${ts.map(q => pickBtn(q, mine === q.id, S.escalated.includes(q.id) ? '+2' : '')).join('')}${pickBtn('skip', mine === 'skip')}</div>
      <p class="note"><b>${vc.voted}/${vc.total}</b> kişi oy verdi. ${mine == null ? 'Tartışırken istediğin an oy verebilirsin.' : 'Oyunu toplantı bitene kadar değiştirebilirsin.'} Herkes oy verince ya da süre bitince sonuç açıklanır. Oy vermeyen Atla sayılır.</p>${reportButton()}${reportHtml()}`;
    box.querySelectorAll('.pbtn').forEach(b => b.onclick = () => socket.emit('vote', { target: b.dataset.id === 'skip' ? 'skip' : +b.dataset.id }));
    bindReport();
    markPick(ts.map(q => q.id), '#FF6E98', typeof mine === 'number' ? [mine] : []);
    return;
  }
  if (S.phase === 'veto'){
    const out = P(S.verdict.outId);
    box.innerHTML = `<h3>Karar</h3>${countsHtml()}<div class="result evil"><b>${esc(out.name)}</b> atılmak üzere.</div>
      ${m.canVeto ? `<div class="result warn"><b>Bu story bu sprintte yok.</b> Tek veto hakkını şimdi kullanabilirsin. Veto edersen ${esc(out.name)} kalır ama herkes senin Product Owner olduğunu öğrenir.</div><div class="row2"><button class="btn danger" id="vetoBtn" type="button">Veto et</button></div>` : '<p class="note">Karar birkaç saniye içinde kesinleşecek.</p>'}${reportButton()}${reportHtml()}`;
    const vb = $('#vetoBtn'); if (vb) vb.onclick = () => socket.emit('po:veto');
    bindReport(); return;
  }
  if (S.phase === 'verdict' || S.phase === 'over'){
    const v = S.verdict;
    box.innerHTML = `<h3>Sonuç</h3>${v ? countsHtml() + `<div class="result ${v.outId ? (v.outTeam === 'evil' ? 'evil' : 'town') : ''}">${v.outId ? `<b>${esc(P(v.outId).name)}</b> repodan atıldı. Rolü: <b>${esc(v.outRole)}</b>.` : esc(v.why)}</div>` : ''}${S.phase === 'over' ? '<div class="row2"><button class="btn primary" id="showEnd" type="button">Sonucu göster</button></div>' : ''}${reportButton()}${reportHtml()}`;
    const se = $('#showEnd'); if (se) se.onclick = () => showEnd();
    bindReport(); return;
  }
  box.innerHTML = '';
}
function countsHtml(){
  const v = S.verdict; if (!v) return '';
  return `<div class="picks" style="grid-template-columns:1fr">${v.counts.map(c => { const q = P(c.id); return `<div class="pbtn static">${avatar(q)}<span class="nm">${esc(q.name)}${v.escalated[c.id] ? ' <small style="color:var(--muted)">(+2 escalation dahil)</small>' : ''}</span><span class="ct">${c.c}</span></div>`; }).join('')}<div class="pbtn static"><span class="nm">Atla</span><span class="ct" style="color:var(--muted)">${v.skip}</span></div></div>`;
}
function onPick(id){
  if (!S || !S.mine) return;
  if (S.phase === 'night'){
    const opt = S.mine.options.find(o => o.kind === ui.kind);
    if (!opt || !opt.targets || !opt.valid.includes(id)) return;
    if (ui.targets.includes(id)) ui.targets = ui.targets.filter(t => t !== id);
    else if (opt.targets === 1) ui.targets = [id];
    else ui.targets = [...ui.targets, id].slice(-opt.targets);
    renderAct();
  } else if (S.phase === 'meeting' && me().alive && id !== S.meId && P(id).alive) socket.emit('vote', { target: id });
}

/* ---------- sesli sohbet ---------- */
$('#voiceBtn').onclick = () => {
  const st = Voice.status();
  if (st.enabled) return Voice.disable();
  Voice.enable().catch(e => toast(e && e.name === 'NotAllowedError' ? 'Mikrofon izni verilmedi. Tarayıcı ayarlarından izin verip tekrar dene.' : 'Mikrofon açılamadı.'));
};
const ptt = $('#pttBtn');
const pttOn = e => { e.preventDefault(); try { ptt.setPointerCapture(e.pointerId); } catch {} Voice.setPtt(true); };
const pttOff = () => Voice.setPtt(false);
ptt.addEventListener('pointerdown', pttOn);
ptt.addEventListener('pointerup', pttOff);
ptt.addEventListener('pointercancel', pttOff);
ptt.addEventListener('lostpointercapture', pttOff);
ptt.addEventListener('contextmenu', e => e.preventDefault());
function renderVoice(){
  if (!S || S.phase === 'lobby') return;
  const st = Voice.status(); const m = me();
  const vb = $('#voiceBtn');
  vb.textContent = st.starting ? 'Mikrofon açılıyor…' : st.enabled ? 'Sesten çık' : 'Sesli sohbete katıl';
  vb.disabled = !st.supported || st.starting;
  vb.classList.toggle('primary', !st.enabled);
  ptt.hidden = !(st.enabled && st.canTalk);
  ptt.classList.toggle('on', st.speaking);
  ptt.textContent = st.speaking ? 'Konuşuyorsun…' : 'Basılı tut, konuş';
  const others = S.players.filter(p => p.voice && p.id !== S.meId).length;
  $('#voiceStat').textContent = !st.supported ? 'Bu tarayıcı sesli sohbeti desteklemiyor.'
    : !st.enabled ? (others ? `${others} kişi seste. Katılınca toplantıda konuşabilirsin.` : 'Toplantıda konuşmak için sesli sohbete katıl.')
    : `Seste ${others + 1} kişi, ${st.connected}/${st.peers} bağlantı kuruldu.`;
  const mic = $('#mic'), tx = $('#micTx');
  mic.classList.toggle('on', st.speaking);
  tx.textContent = !st.enabled ? 'Ses kapalı'
    : st.speaking ? 'Konuşuyorsun'
    : S.phase !== 'meeting' ? 'Ses sadece toplantıda'
    : !m.alive ? 'Dinliyorsun'
    : 'Space basılı tut';
  stage.querySelectorAll('.avatar').forEach(a => a.classList.toggle('talk', Voice.isTalking(+a.dataset.id)));
}

/* ---------- bildirimler ---------- */
function renderLog(){
  const l = (S.mine && S.mine.log) || [];
  $('#logBox').hidden = !l.length;
  $('#log').innerHTML = l.slice().reverse().map(e => `<div class="result ${e.cls}"><small>${e.day ? (S.phase === 'night' && e.day === S.day ? 'Bu gece' : `Gece ${e.day}`) : 'Başlangıç'}</small>${esc(e.text)}</div>`).join('');
}

function refreshChatInput(){
  const mode = chatMode(); const inp = $('#chatIn');
  inp.disabled = !mode; $('#chatSend').disabled = !mode;
  inp.placeholder = mode === 'standup' ? '#standup · herkese yaz' : mode === 'sabotaj' ? '#sabotaj · ortaklarına yaz' : mode === 'mezarlik' ? '#mezarlık · sadece düşenler görür' : 'Gece yazamazsın';
  $('#chatTitle').textContent = mode === 'sabotaj' ? 'Sohbet · #sabotaj açık' : mode === 'mezarlik' ? 'Sohbet · #mezarlık' : 'Sohbet · #standup';
}

/* ---------- zamanlayıcı ---------- */
setInterval(() => {
  if (!S || !S.timerEnd) { $('#timer').textContent = '--'; return; }
  const s = Math.max(0, Math.ceil((S.timerEnd - (Date.now() + skew)) / 1000));
  $('#timer').textContent = `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;
}, 250);

/* ---------- gece animasyonları (sadece hamleyi yapan görür) ---------- */
async function nightAnim(kind, ids){
  const t = ids[0] != null ? P(ids[0]) : null;
  const nm = t ? esc(t.name) : '';
  clearFx();
  if (kind === 'hack'){
    const p = pt(t.id, 200, 95);
    const lines = ['rm -rf /prod','sudo kill -9',`DROP TABLE ${t.name.toLowerCase()};`,'curl evil.sh | sh'];
    await Promise.all(lines.map((txt, i) => { const d = el(esc(txt), p.x - 160, p.y - 40 + i*18, 'term'); return anim(d, [{ transform:'translate(0,0)', opacity:0 }, { opacity:1, offset:.2 }, { transform:`translate(160px,${40 - i*18}px) scale(.4)`, opacity:0 }], { duration:900, delay:i*110, easing:'cubic-bezier(.6,0,.9,.6)' }); }));
    const o = offices.get(t.id); o.classList.add('red','glitch'); setTimeout(() => o.classList.remove('glitch'), 900);
    fxSign(t.id, 'hedef', '#FF6E98'); caption(`<b>${nm}</b> hedef alındı. Sonucu sabah göreceksin.`, '#FF6E98');
  } else if (kind === 'social'){
    const p = pt(t.id, 150, 30);
    const w = el(`<div class="card" style="color:#C42656"><small>git log · sahte commit</small>feat: backdoor ekle</div>`, p.x - 80, p.y - 40);
    await anim(w, [{ opacity:0, transform:'translateY(14px) scale(.9)' }, { opacity:1, transform:'none' }], { duration:450 });
    fxSign(t.id, 'tuzak', '#FF6E98'); caption(`<b>${nm}</b>${sfx(t.name,'in')} geçmişi sahtelendi. Bu gece Senior Dev onu sabotajcı görür.`, '#FF6E98');
  } else if (kind === 'senior'){
    const p = pt(t.id, 150, 110);
    const m = el(`<svg width="54" height="54" viewBox="0 0 64 64"><circle cx="26" cy="26" r="18" fill="rgba(169,156,255,.18)" stroke="#A99CFF" stroke-width="5"/><line x1="40" y1="40" x2="58" y2="58" stroke="#A99CFF" stroke-width="7" stroke-linecap="round"/></svg>`, 0, 0);
    await anim(m, [{ transform:`translate(${p.x-90}px,${p.y-20}px)`, opacity:0 }, { transform:`translate(${p.x}px,${p.y-50}px)`, opacity:1, offset:.5 }, { transform:`translate(${p.x-27}px,${p.y-27}px)`, opacity:1 }], { duration:1300, easing:'ease-in-out' });
    fxSign(t.id, 'review', '#A99CFF'); caption(`<b>${nm}</b>${sfx(t.name,'in')} kodu review ediliyor. Sonuç sabah gelecek.`, '#A99CFF');
  } else if (kind === 'qa' || kind === 'freelancer'){
    const id = t ? t.id : S.meId; const c = pt(id, 150, 160); const rx = 130*c.s, ry = 72*c.s;
    const sh = el('', c.x - rx, c.y - ry); Object.assign(sh.style, { width:2*rx+'px', height:2*ry+'px', borderRadius:'50%', border:'3px solid #3FCDB8', boxShadow:'0 0 30px rgba(63,205,184,.7), inset 0 0 30px rgba(63,205,184,.4)' });
    await anim(sh, [{ opacity:0, transform:'scale(.7)' }, { opacity:1, transform:'scale(1.06)' }, { opacity:.9, transform:'scale(1)' }], { duration:700 });
    fxSign(id, 'korunuyor', '#3FCDB8'); caption(kind === 'qa' ? `<b>${nm}</b> bu gece test altında. Saldırıya uğrarsa kurtulur.` : 'Bu gece kendini koruyorsun. Kontrat sağlam.', '#3FCDB8');
  } else if (kind === 'devops'){
    const p = pt(t.id, 250, 20);
    const w = el(`<div class="card" style="font-size:12px;background:#0A0C1C;color:#F2C94C;border:1px solid #2B3264"><small style="color:#979EC6">tail -f</small>${esc(t.name.toLowerCase())}.log izleniyor</div>`, p.x - 60, p.y - 30);
    await anim(w, [{ opacity:0, transform:'scale(.9)' }, { opacity:1, transform:'none' }], { duration:400 });
    fxSign(t.id, 'izleniyor', '#F2C94C'); caption(`<b>${nm}</b>${sfx(t.name,'in')} ofisi izleniyor. Gelenleri sabah göreceksin.`, '#F2C94C');
  } else if (kind === 'uiux'){
    const tl = pt(t.id, 40, 20), br = pt(t.id, 260, 225);
    const heat = el('', tl.x, tl.y); Object.assign(heat.style, { width:(br.x-tl.x)+'px', height:(br.y-tl.y)+'px', borderRadius:'14px', mixBlendMode:'screen', background:'radial-gradient(circle at 70% 42%, rgba(255,60,60,.85) 0 8%, rgba(255,170,40,.6) 16%, rgba(90,220,120,.35) 28%, transparent 40%), radial-gradient(circle at 38% 62%, rgba(255,170,40,.55) 0 6%, rgba(90,220,120,.3) 16%, transparent 26%)' });
    await anim(heat, [{ opacity:0, transform:'scale(.92)' }, { opacity:1, transform:'scale(1)' }], { duration:700 });
    fxSign(t.id, 'heatmap', '#FF8C3B'); caption(`<b>${nm}</b>${sfx(t.name,'in')} ısı haritası çıkarılıyor. Kime tıkladığını sabah göreceksin.`, '#FF8C3B');
  } else if (kind === 'scrum'){
    const p = pt(t.id, 95, 55);
    const k = el(`<div class="card" style="background:#FFFFFF"><small style="color:#2440C9">Takvim daveti</small>Acil toplantı<small>02:00 · zorunlu</small></div>`, p.x - 60, p.y - 30);
    await anim(k, [{ transform:'translate(-120px,-60px) rotate(-30deg) scale(.6)', opacity:0 }, { transform:'rotate(-6deg)', opacity:1 }], { duration:900 });
    offices.get(t.id).classList.add('blocked'); fxSign(t.id, 'toplantıda', '#7FA2FF');
    caption(`<b>${nm}</b> bu gece toplantıda. Hamlesi boşa gidecek.`, '#7FA2FF');
  } else if (kind === 'lead'){
    const p = pt(t.id, 150, 40);
    const k = el(`<div class="card" style="background:#FFFFFF;color:#C42656"><small>JIRA · P1</small>ESCALATED<small>${nm} · retroda öncelikli</small></div>`, p.x - 70, p.y - 40);
    await anim(k, [{ transform:'translateY(-120px) rotate(-20deg) scale(1.4)', opacity:0 }, { transform:'rotate(-6deg)', opacity:1 }], { duration:650, easing:'cubic-bezier(.6,0,.9,.4)' });
    fxSign(t.id, 'escalated', '#C42656'); caption(`<b>${nm}</b> escalate edildi. Oylamaya 2 oyla başlayacak.`, '#C42656');
  } else if (kind === 'junior'){
    const r = stage.getBoundingClientRect();
    const k = el(`<div class="card" style="background:#FFFFFF;gap:4px"><small style="color:#C2410C">stackoverflow · soru</small>Ekipte kim kesinlikle sabotajcı değil?<small>cevap sabah gelecek · 42 oy</small></div>`, r.width/2, r.height*0.2);
    await anim(k, [{ opacity:0, transform:'translate(-50%,-14px)' }, { opacity:1, transform:'translate(-50%,0)' }], { duration:400 });
    caption('Soru gönderildi. Cevabı sabah bildirimlerinde göreceksin.', '#C2410C');
  } else if (kind === 'intern'){
    const p = pt(t.id, 150, 30);
    const k = el(`<div class="card" style="background:#FFFFFF;color:#0B8A79"><small>onboarding</small>Mentorum: ${nm}</div>`, p.x - 70, p.y - 40);
    await anim(k, [{ opacity:0, transform:'scale(.6)' }, { opacity:1, transform:'scale(1)' }], { duration:450 });
    fxSign(t.id, 'mentor', '#0B8A79'); caption(`<b>${nm}</b> artık mentorun. O düşerse rolünü devralırsın.`, '#0B8A79');
  } else if (kind === 'architect'){
    const tl = pt(t.id, 20, 10), br = pt(t.id, 280, 235);
    const g = el('', tl.x, tl.y); Object.assign(g.style, { width:(br.x-tl.x)+'px', height:(br.y-tl.y)+'px', borderRadius:'12px', border:'1.5px solid rgba(120,190,255,.9)', background:'repeating-linear-gradient(0deg, rgba(90,170,255,.35) 0 1px, transparent 1px 14px), repeating-linear-gradient(90deg, rgba(90,170,255,.35) 0 1px, transparent 1px 14px), rgba(30,90,200,.25)' });
    await anim(g, [{ clipPath:'circle(0% at 50% 60%)' }, { clipPath:'circle(75% at 50% 60%)' }], { duration:800 });
    fxSign(t.id, 'blueprint', '#5AAAFF'); caption(`<b>${nm}</b>${sfx(t.name,'in')} mimarisi inceleniyor. İki olası rolü sabah göreceksin.`, '#5AAAFF');
  } else if (kind === 'config'){
    const [a, b] = ids.map(id => pt(id, 150, 120));
    const k1 = el(`<div class="card" style="color:#6B46C1"><small>config.yml</small>${esc(P(ids[0]).name)} ⇄ ${esc(P(ids[1]).name)}</div>`, (a.x + b.x)/2 - 70, (a.y + b.y)/2 - 30);
    await anim(k1, [{ opacity:0, transform:'rotate(-180deg) scale(.4)' }, { opacity:1, transform:'rotate(0) scale(1)' }], { duration:700 });
    ids.forEach(id => fxSign(id, 'takas', '#9F7AEA'));
    caption(`Bu gece <b>${esc(P(ids[0]).name)}</b> ile <b>${esc(P(ids[1]).name)}</b> arasındaki hamleler yer değiştirecek.`, '#9F7AEA');
  } else if (kind === 'plant'){
    const f = pt(t.id, 150, 175);
    const b = el(`<svg width="40" height="46" viewBox="0 0 44 50"><circle cx="22" cy="30" r="17" fill="#1B1B24" stroke="#000" stroke-width="2"/><rect x="18" y="8" width="8" height="8" rx="2" fill="#2B2B36"/><path d="M22 8 q4 -6 10 -4" stroke="#C98B3A" stroke-width="2.5" fill="none"/><text x="22" y="34" text-anchor="middle" font-family="JetBrains Mono" font-size="9" fill="#FF6E98">00:00</text></svg>`, f.x - 20, f.y - 46);
    await anim(b, [{ transform:'translateY(-60px)', opacity:0 }, { transform:'translateY(0)', opacity:1 }], { duration:600, easing:'cubic-bezier(.5,0,.8,.4)' });
    fxSign(t.id, 'bomba', '#F2B850'); caption(`<b>${nm}</b>${sfx(t.name,'in')} ofisine bomba gömüldü.`, '#F2B850');
  } else if (kind === 'detonate'){
    stage.animate([{ transform:'translate(0)' }, { transform:'translate(-8px,4px)' }, { transform:'translate(7px,-3px)' }, { transform:'translate(0)' }], { duration:350, iterations:2 });
    caption('Bütün bombalar patlatılıyor. Sonucu sabah göreceksin.', '#F2B850');
  }
}
async function reportAnim(r){
  const rr = stage.getBoundingClientRect();
  const lines = r.votes.map(v => { const a = P(v.voter), t = v.target === 'skip' ? null : P(v.target); return a ? `<span style="display:block;text-align:left;font-family:var(--mono);font-weight:400;font-size:.62em;color:#121829">${esc(a.name)} → ${t ? esc(t.name) : 'Atla'}</span>` : ''; }).join('');
  const k = el(`<div class="card" style="gap:2px;border-top:6px solid #5AAAFF"><small style="color:#2440C9">Analiz · oy raporu · Gün ${r.day}</small>${lines}</div>`, rr.width/2, rr.height*0.45);
  await anim(k, [{ transform:'translate(-50%,-50%) perspective(600px) rotateX(70deg)', opacity:0 }, { transform:'translate(-50%,-50%) perspective(600px) rotateX(0)', opacity:1 }], { duration:600 });
  caption('Oy raporu açıldı. <b>Bunu sadece sen görüyorsun.</b>', '#5AAAFF');
  setTimeout(() => k.remove(), 4000);
}

/* ---------- oyun sonu ---------- */
function showEnd(){
  const titles = { town:'Prod kurtarıldı. <span style="color:var(--town)">Ekip</span> kazandı.', evil:'Prod çöktü. <span style="color:var(--evil)">Sabotaj</span> kazandı.', logicbomb:'<span style="color:var(--neutral)">Logic Bomb</span> kazandı.', none:'Oyun berabere bitti.' };
  const meP = me();
  $('#endTitle').innerHTML = titles[S.winTeam] || 'Oyun bitti';
  $('#endSub').textContent = meP.winner ? 'Kazananlar arasındasın.' : 'Bu sefer kaybettin.';
  $('#endReveal').innerHTML = S.players.map(p => `<div class="${p.winner ? 'win' : ''}"><b>${esc(p.name)}${p.id === S.meId ? ' (sen)' : ''}</b><small class="t-${p.team}">${esc(p.role || '')} · ${p.alive ? 'hayatta' : 'düştü'}${p.winner ? ' · kazandı' : ''}</small></div>`).join('');
  $('#againBtn').hidden = !isHost();
  $('#againNote').textContent = isHost() ? '' : 'Kurucu yeni oyunu lobiden başlatacak.';
  $('#endBox').hidden = false;
  if (meP.winner) confetti();
}
$('#againBtn').onclick = () => socket.emit('game:lobby');
$('#closeEnd').onclick = () => { $('#endBox').hidden = true; };
function confetti(){
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const c = document.createElement('canvas'); c.className = 'confetti'; stage.appendChild(c);
  const r = stage.getBoundingClientRect(); c.width = r.width; c.height = r.height; const ctx = c.getContext('2d');
  const cols = ['#3FCDB8','#A99CFF','#F2C94C','#FF8FB1','#7FA2FF'];
  const ps = Array.from({ length:140 }, () => ({ x:r.width/2, y:r.height*0.45, vx:(Math.random()-.5)*14, vy:-Math.random()*12-4, s:6+Math.random()*6, a:Math.random()*6, va:(Math.random()-.5)*.4, c:cols[Math.floor(Math.random()*cols.length)] }));
  const t0 = performance.now();
  (function frame(t){ ctx.clearRect(0, 0, r.width, r.height); for (const p of ps){ p.vy += .28; p.x += p.vx; p.y += p.vy; p.a += p.va; ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a); ctx.fillStyle = p.c; ctx.fillRect(-p.s/2, -p.s/4, p.s, p.s/2); ctx.restore(); } if (t - t0 < 2600) requestAnimationFrame(frame); else c.remove(); })(t0);
}
})();

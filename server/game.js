'use strict';

const crypto = require('crypto');
const { ROLES, TEAM_NAME, TOWN_ROLES, CUSTOM_KEYS, usesFor, autoRoles, customRoles, shuffle } = require('./roles');
const { ek } = require('./text');

const MIN_PLAYERS = 5;
const MAX_PLAYERS = 12;
// PHV_TIME_SCALE testlerde süreleri kısaltır
const SCALE = Number(process.env.PHV_TIME_SCALE || 1);
const DUR = { night: 45, morning: 7, meeting: 120, veto: 8, verdict: 6 };
const BOT_NAMES = ['Ayşe', 'Kaan', 'Deniz', 'Can', 'Zeynep', 'Mert', 'Elif', 'Emre', 'Selin', 'Burcu', 'Onur', 'Ece'];
const rnd = a => a[Math.floor(Math.random() * a.length)];
const token = () => crypto.randomBytes(12).toString('hex');

class Room {
  constructor(code, onChange) {
    this.code = code;
    this.onChange = onChange;
    this.players = [];
    this.nextId = 1;
    this.hostId = null;
    this.settings = { mode: 'auto', traitor: false, logicBomb: true, counts: {} };
    this.chat = [];
    this.nextMsg = 1;
    this.resetGame();
  }

  resetGame() {
    clearTimeout(this.timer);
    this.phase = 'lobby';
    this.day = 0;
    this.timerEnd = null;
    this.acts = new Map();
    this.votes = new Map();
    this.escalated = {};
    this.bombs = new Set();
    this.logs = {};
    this.morning = null;
    this.verdict = null;
    this.lastBallot = null;
    this.reports = {};
    this.winTeam = null;
    this.winners = [];
    this.pmWinners = [];
    this.error = null;
    this.chat = [];
    for (const p of this.players) Object.assign(p, { alive: true, role: null, traitor: false, uses: 0, mentorId: null, poRevealed: false });
  }

  // ---------- oyuncular ----------
  addPlayer(name, isBot = false) {
    if (this.phase !== 'lobby') return { error: 'Oyun başlamış. Bitince katılabilirsin.' };
    if (this.players.length >= MAX_PLAYERS) return { error: 'Oda dolu (en fazla 12 kişi).' };
    let clean = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 14) || 'Oyuncu';
    const base = clean; let i = 2;
    while (this.players.some(p => p.name.toLocaleLowerCase('tr') === clean.toLocaleLowerCase('tr'))) clean = `${base} ${i++}`;
    const p = { id: this.nextId++, token: token(), name: clean, isBot, connected: isBot, alive: true, role: null, traitor: false, uses: 0, mentorId: null, poRevealed: false, lastSeen: Date.now() };
    this.players.push(p);
    if (!this.hostId && !isBot) this.hostId = p.id;
    this.changed();
    return { player: p };
  }

  addBot() {
    const used = new Set(this.players.map(p => p.name));
    const name = BOT_NAMES.find(n => !used.has(n)) || 'Bot';
    return this.addPlayer(name, true);
  }

  removePlayer(id) {
    if (this.phase !== 'lobby') return;
    this.players = this.players.filter(p => p.id !== id);
    if (this.hostId === id) { const h = this.players.find(p => !p.isBot); this.hostId = h ? h.id : null; }
    this.changed();
  }

  byId(id) { return this.players.find(p => p.id === id); }
  byToken(t) { return this.players.find(p => p.token === t); }
  humans() { return this.players.filter(p => !p.isBot); }
  alive() { return this.players.filter(p => p.alive); }
  team(p) { return p.traitor ? 'evil' : ROLES[p.role].team; }
  isEvil(p) { return this.team(p) === 'evil'; }
  isKiller(p) {
    if (!p.alive) return false;
    if (p.role === 'hacker') return true;
    if (p.role === 'social') return !this.players.some(q => q.alive && q.role === 'hacker');
    return false;
  }
  log(p, text, cls = '') { (this.logs[p.id] = this.logs[p.id] || []).push({ day: this.day, text, cls }); }
  sys(text) { this.addChat(null, 'system', text); }
  addChat(from, ch, text) {
    this.chat.push({ id: this.nextMsg++, from, ch, text, day: this.day });
    if (this.chat.length > 300) this.chat.shift();
  }

  setSettings(by, s) {
    if (by !== this.hostId || this.phase !== 'lobby') return;
    if (s.mode === 'auto' || s.mode === 'custom') this.settings.mode = s.mode;
    if (typeof s.traitor === 'boolean') this.settings.traitor = s.traitor;
    if (typeof s.logicBomb === 'boolean') this.settings.logicBomb = s.logicBomb;
    if (s.counts && typeof s.counts === 'object') {
      const c = {};
      for (const k of CUSTOM_KEYS) c[k] = Math.max(0, Math.min(12, parseInt(s.counts[k], 10) || 0));
      this.settings.counts = c;
    }
    this.error = null;
    this.changed();
  }

  // ---------- oyun başlangıcı ----------
  start(by) {
    if (by !== this.hostId || this.phase !== 'lobby') return;
    const n = this.players.length;
    if (n < MIN_PLAYERS) { this.error = `En az ${MIN_PLAYERS} oyuncu gerekli. Arkadaşlarını davet et ya da bot ekle.`; return this.changed(); }
    const res = this.settings.mode === 'custom' ? customRoles(n, this.settings.counts) : autoRoles(n, this.settings);
    if (res.error) { this.error = res.error; return this.changed(); }
    const roles = shuffle(res.roles);
    const order = shuffle(this.players);
    order.forEach((p, i) => { p.role = roles[i]; p.alive = true; p.traitor = false; p.mentorId = null; p.poRevealed = false; p.known = {}; p.killerNotified = false; });
    const townPlayers = shuffle(this.players.filter(p => ROLES[p.role].team === 'town'));
    townPlayers.slice(0, res.traitors).forEach(p => { p.traitor = true; });
    this.players.forEach(p => { p.uses = usesFor(p.role, n); });
    this.error = null; this.chat = []; this.logs = {};
    this.sys(`Oyun başladı. ${n} oyuncu. Roller gizli.`);
    for (const p of this.players) {
      if (this.isEvil(p)) {
        const mates = this.players.filter(q => q !== p && this.isEvil(q)).map(q => `${q.name} (${this.roleLabel(q)})`);
        this.log(p, mates.length ? `Sabotaj ekibindesin. Ortakların: ${mates.join(', ')}.` : 'Sabotaj ekibindesin. Bu oyunda tek başınasın.', 'evil');
      }
    }
    this.startNight();
  }

  roleLabel(p) { return (p.traitor ? 'Hain ' : '') + ROLES[p.role].name; }

  // ---------- zamanlayıcı ----------
  setPhase(phase, secs, next) {
    clearTimeout(this.timer);
    this.phase = phase;
    if (phase !== 'meeting') for (const p of this.players) p.talking = false;
    this.timerEnd = secs ? Date.now() + secs * 1000 * SCALE : null;
    if (secs) this.timer = setTimeout(() => next(), secs * 1000 * SCALE);
    this.changed();
  }

  // ---------- gece ----------
  // Oyuncunun bu gece seçebileceği hamleler
  nightOptions(p) {
    if (!p.alive || this.phase !== 'night') return [];
    const opts = [];
    const r = ROLES[p.role];
    const own = () => {
      if (p.role === 'po' || p.role === 'pm') return;
      if (p.role === 'hacker') return;
      if (p.role === 'social' && this.isKiller(p)) return;
      if (p.role === 'intern' && p.mentorId) return;
      if (p.role === 'logicbomb') {
        opts.push({ kind: 'plant', verb: 'Bomba göm', targets: 1 });
        if ([...this.bombs].some(id => this.byId(id).alive)) opts.push({ kind: 'detonate', verb: 'Bombaları patlat', targets: 0 });
        return;
      }
      if (p.role === 'analyst') {
        if (p.uses > 0 && this.lastBallot) opts.push({ kind: 'report', verb: r.verb, targets: 0, instant: true });
        return;
      }
      if (p.uses <= 0) return;
      opts.push({ kind: p.role, verb: r.verb, targets: r.target });
    };
    if (this.isKiller(p)) opts.push({ kind: 'hack', verb: 'Hackle', targets: 1 });
    else if (p.traitor) { own(); opts.push({ kind: 'hack', verb: 'Hackle', targets: 1 }); }
    else own();
    return opts;
  }

  // Hedef seçilebilecek oyuncular
  validTargets(p, kind) {
    const others = this.alive().filter(q => q !== p);
    if (kind === 'hack' || kind === 'social') return others.filter(q => !this.isEvil(q));
    if (kind === 'config') return this.alive();
    return others;
  }

  startNight() {
    this.day++;
    this.acts = new Map();
    this.escalated = {};
    this.morning = null; this.verdict = null;
    this.nightEnding = false;
    this.sys(`Gece ${this.day}. Herkes ofisinde.`);
    this.phase = 'night'; // botların hamle seçenekleri gece fazına bağlı
    for (const b of this.alive().filter(p => p.isBot)) this.botNight(b);
    this.setPhase('night', DUR.night, () => this.resolveNight());
    this.checkNightDone();
  }

  submitAct(p, kind, targets = []) {
    if (this.phase !== 'night' || !p.alive) return;
    const opt = this.nightOptions(p).find(o => o.kind === kind);
    if (!opt) return;
    if (opt.instant) return this.openReport(p);
    targets = [...new Set((Array.isArray(targets) ? targets : []).map(Number))];
    if (targets.length !== opt.targets) return;
    const valid = this.validTargets(p, kind).map(q => q.id);
    if (!targets.every(t => valid.includes(t))) return;
    this.acts.set(p.id, { kind, targets, pass: false });
    this.changed();
    this.checkNightDone();
  }

  pass(p) {
    if (this.phase !== 'night' || !p.alive) return;
    this.acts.set(p.id, { kind: 'pass', targets: [], pass: true });
    this.changed();
    this.checkNightDone();
  }

  checkNightDone() {
    if (this.phase !== 'night') return;
    const waiting = this.alive().filter(p => !p.isBot && p.connected && !this.acts.has(p.id) && this.nightOptions(p).some(o => !o.instant));
    if (waiting.length === 0 && !this.nightEnding) {
      this.nightEnding = true;
      clearTimeout(this.timer);
      this.timerEnd = Date.now() + 1500 * SCALE;
      this.timer = setTimeout(() => this.resolveNight(), 1500 * SCALE);
    }
  }

  resolveNight() {
    if (this.phase !== 'night') return;
    const n = this.players.length;
    const raw = [...this.acts.entries()].filter(([, a]) => !a.pass).map(([id, a]) => {
      const actor = this.byId(id);
      // Freelancer kendini hedef alır; takas ona da uygulanır
      return { actor, kind: a.kind, targets: a.kind === 'freelancer' ? [actor.id] : a.targets.slice() };
    }).filter(a => a.actor.alive);
    // hak düşür
    for (const a of raw) if (!['hack', 'plant', 'detonate'].includes(a.kind) && a.actor.uses !== Infinity) a.actor.uses = Math.max(0, a.actor.uses - 1);
    // 1. Konfigürasyoncu takası
    let acts = raw;
    for (const c of raw.filter(a => a.kind === 'config')) {
      const [x, y] = c.targets; const m = t => t === x ? y : t === y ? x : t;
      acts = acts.map(a => a === c ? a : { ...a, targets: a.targets.map(m) });
    }
    for (const c of raw.filter(a => a.kind === 'config')) this.log(c.actor, `${this.byId(c.targets[0]).name} ile ${this.byId(c.targets[1]).name} arasındaki hamleleri takas ettin.`, 'town');
    // 2. Scrum engeli
    const blocked = new Set(acts.filter(a => a.kind === 'scrum').flatMap(a => a.targets));
    for (const a of acts) if (blocked.has(a.actor.id) && a.kind !== 'config') this.log(a.actor, 'Dün gece acil toplantıya çekildin. Hamlen boşa gitti.', 'warn');
    for (const a of acts.filter(a => a.kind === 'scrum')) this.log(a.actor, `${ek(this.byId(a.targets[0]).name, 'i')} toplantıya çektin.`, 'town');
    acts = acts.filter(a => !blocked.has(a.actor.id) || a.kind === 'config');
    const of = kind => acts.filter(a => a.kind === kind);
    // 3. koruma ve tuzak
    const protectedBy = new Map();
    for (const a of [...of('qa'), ...of('freelancer')]) protectedBy.set(a.targets[0], a.actor);
    const framed = new Set(of('social').map(a => a.targets[0]));
    for (const a of of('social')) this.log(a.actor, `${ek(this.byId(a.targets[0]).name, 'in')} geçmişini sahteledin. Bu gece Senior Dev ona bakarsa sabotajcı görür.`, 'evil');
    // 4. ziyaretler
    const visits = acts.filter(a => a.kind !== 'config' && a.kind !== 'freelancer' && a.targets.length);
    // 5. bilgi rolleri
    for (const a of of('senior')) {
      const t = this.byId(a.targets[0]);
      const team = framed.has(t.id) ? 'evil' : this.team(t);
      if (a.actor.isBot) (a.actor.known = a.actor.known || {})[t.id] = team;
      this.log(a.actor, `Code review: ${t.name} ${team === 'evil' ? 'Sabotaj ekibinde.' : team === 'neutral' ? 'tarafsız.' : 'Ekip üyesi.'}`, team === 'evil' ? 'evil' : team === 'neutral' ? 'warn' : 'town');
    }
    for (const a of of('architect')) {
      const t = this.byId(a.targets[0]); const team = this.team(t);
      const otherTown = () => rnd(TOWN_ROLES.filter(r => r !== t.role));
      const evilRole = () => rnd(['hacker', 'social'].filter(r => r !== t.role));
      let pair;
      if (team === 'evil') pair = t.traitor ? [t.role, evilRole()] : [otherTown(), t.role];
      else if (team === 'neutral') pair = [t.role, otherTown()];
      else pair = [t.role, evilRole()];
      pair = shuffle(pair).map(r => ROLES[r].name);
      this.log(a.actor, `Mimari inceleme: ${t.name} ya ${pair[0]} ya da ${pair[1]}. Biri doğru.`, 'town');
    }
    for (const a of of('devops')) {
      const tid = a.targets[0];
      const vis = visits.filter(v => v.actor !== a.actor && v.targets.includes(tid)).map(v => v.actor.name);
      this.log(a.actor, `Loglar: ${ek(this.byId(tid).name, 'in')} ofisine ${vis.length ? [...new Set(vis)].join(', ') + ' gitti.' : 'kimse gelmedi.'}`, 'warn');
    }
    for (const a of of('uiux')) {
      const t = this.byId(a.targets[0]);
      const went = visits.filter(v => v.actor === t).flatMap(v => v.targets).filter(id => id !== t.id).map(id => this.byId(id).name);
      this.log(a.actor, `Isı haritası: ${t.name} dün gece ${went.length ? [...new Set(went)].join(', ') + ' ofisine tıkladı.' : 'hiçbir yere tıklamadı.'}`, 'warn');
    }
    for (const a of of('junior')) {
      const clean = this.alive().filter(q => q !== a.actor && !this.isEvil(q));
      if (clean.length) this.log(a.actor, `StackOverflow cevabı: ${rnd(clean).name} kesinlikle sabotajcı değil.`, 'town');
    }
    for (const a of of('intern')) {
      a.actor.mentorId = a.targets[0];
      this.log(a.actor, `Mentorun artık ${this.byId(a.targets[0]).name}. O düşerse rolünü devralırsın.`, 'town');
    }
    for (const a of of('lead')) {
      const t = this.byId(a.targets[0]); this.escalated[t.id] = 2;
      this.log(a.actor, `${t.name} için P1 escalation açtın. Bugünkü oylamaya 2 oyla başlayacak.`, 'warn');
    }
    // 6. saldırılar
    const deaths = new Map(); let saved = 0; const guardsUsed = new Set();
    const attack = (tid, cause, attacker) => {
      const t = this.byId(tid);
      if (!t.alive || deaths.has(tid)) return;
      const guard = protectedBy.get(tid);
      if (guard) {
        saved++; guardsUsed.add(guard.id);
        if (guard.role === 'qa') this.log(guard, `${ek(t.name, 'e')} gece saldırı oldu. Testlerin onu kurtardı.`, 'town');
        this.log(t, 'Dün gece saldırıya uğradın ama kurtarıldın.', 'warn');
        if (attacker) this.log(attacker, `${t.name} korunuyordu. Saldırın başarısız oldu.`, 'warn');
        return;
      }
      deaths.set(tid, cause);
    };
    for (const a of of('hack')) attack(a.targets[0], 'hack', a.actor);
    for (const a of of('plant')) { this.bombs.add(a.targets[0]); this.log(a.actor, `${ek(this.byId(a.targets[0]).name, 'in')} ofisine bomba gömdün.`, 'warn'); }
    for (const a of of('detonate')) {
      const ids = [...this.bombs].filter(id => this.byId(id).alive);
      ids.forEach(id => attack(id, 'bomb', a.actor));
      this.bombs.clear();
      this.log(a.actor, `${ids.length} bombayı patlattın.`, 'warn');
    }
    for (const a of of('freelancer')) this.log(a.actor, a.targets[0] === a.actor.id ? 'Dün gece kendini korudun.' : `Korumanı bir takas yüzünden ${this.byId(a.targets[0]).name} aldı.`, 'town');
    for (const a of of('qa')) if (!guardsUsed.has(a.actor.id)) this.log(a.actor, `${ek(this.byId(a.targets[0]).name, 'i')} korudun.`, 'town');
    // 7. ölümler
    const died = [];
    for (const [id, cause] of deaths) { const p = this.byId(id); p.alive = false; died.push({ id, cause, role: this.roleLabel(p) }); }
    for (const d of died) {
      const p = this.byId(d.id);
      this.sys(`${p.name} ${d.cause === 'bomb' ? 'bir logic bomb ile' : 'gece hacklenerek'} prod'dan düştü. Rolü: ${this.roleLabel(p)} (${TEAM_NAME[this.team(p)]}).`);
      this.log(p, 'Prod\'dan düştün. Toplantıyı izleyebilirsin ama konuşamazsın. #mezarlık açık.', 'evil');
    }
    if (!died.length) this.sys(saved ? 'Gece bir saldırı engellendi. Kimse düşmedi.' : 'Gece kimse düşmedi.');
    for (const id of Object.keys(this.escalated)) if (!this.byId(+id).alive) delete this.escalated[id];
    this.inheritance();
    this.morning = { deaths: died, saved };
    if (this.checkWin()) return;
    this.setPhase('morning', DUR.morning, () => this.startMeeting());
  }

  // Stajyer mentoru düşünce rolünü alır; Hacker düşünce Sosyal Mühendis'e haber verilir
  inheritance() {
    const n = this.players.length;
    for (const p of this.alive().filter(p => p.role === 'intern' && p.mentorId)) {
      const m = this.byId(p.mentorId);
      if (m.alive) continue;
      p.role = m.role; p.traitor = m.traitor; p.uses = usesFor(p.role, n); p.mentorId = null;
      this.log(p, `Mentorun ${m.name} düştü. Artık sen ${this.roleLabel(p)} oldun (${TEAM_NAME[this.team(p)]}).`, this.isEvil(p) ? 'evil' : 'town');
    }
    if (!this.players.some(q => q.alive && q.role === 'hacker')) {
      for (const s of this.alive().filter(q => q.role === 'social' && !q.killerNotified)) { s.killerNotified = true; this.log(s, 'Hacker düştü. Artık geceleri sen hackliyorsun.', 'evil'); }
    }
  }

  // ---------- İş Analisti ----------
  openReport(p) {
    if (p.role !== 'analyst' || !p.alive || p.uses <= 0 || !this.lastBallot) return;
    if (!['night', 'verdict', 'veto', 'morning', 'meeting'].includes(this.phase)) return;
    p.uses--;
    this.reports[p.id] = this.lastBallot;
    this.log(p, `Gün ${this.lastBallot.day} oy raporunu açtın.`, 'town');
    this.changed();
  }

  // ---------- toplantı ve oylama ----------
  startMeeting() {
    this.votes = new Map();
    for (const id of Object.keys(this.escalated)) this.sys(`JIRA: ${this.byId(+id).name} için P1 escalation açıldı. Oylamaya 2 oyla başlıyor. Kimin açtığı gizli.`);
    for (const b of this.alive().filter(p => p.isBot)) {
      const delay = (8000 + Math.random() * (DUR.meeting * 1000 * 0.6)) * SCALE;
      setTimeout(() => { if (this.phase === 'meeting' && b.alive) this.vote(b, this.botVote(b)); }, delay);
    }
    this.setPhase('meeting', DUR.meeting, () => this.endVote());
  }

  vote(p, target) {
    if (this.phase !== 'meeting' || !p.alive) return;
    if (target !== 'skip') { target = Number(target); const t = this.byId(target); if (!t || !t.alive || t === p) return; }
    const first = !this.votes.has(p.id);
    this.votes.set(p.id, target);
    if (first && this.votes.size >= this.alive().length && !this.closing) {
      this.closing = true;
      clearTimeout(this.timer);
      this.timerEnd = Date.now() + 3000 * SCALE;
      this.timer = setTimeout(() => this.endVote(), 3000 * SCALE);
    }
    this.changed();
  }

  endVote() {
    if (this.phase !== 'meeting') return;
    this.closing = false;
    for (const p of this.alive()) if (!this.votes.has(p.id)) this.votes.set(p.id, 'skip');
    const counts = {}; let skip = 0;
    for (const p of this.alive()) counts[p.id] = this.escalated[p.id] || 0;
    for (const v of this.votes.values()) { if (v === 'skip') skip++; else counts[v] = (counts[v] || 0) + 1; }
    const sorted = Object.entries(counts).map(([id, c]) => ({ id: +id, c })).sort((a, b) => b.c - a.c);
    const top = sorted[0] ? sorted[0].c : 0; const tops = sorted.filter(s => s.c === top);
    let outId = null, why = '';
    if (top === 0) why = 'Kimse oy almadı.';
    else if (tops.length > 1) why = 'En yüksek oyda eşitlik var. Kimse atılmadı.';
    else if (skip >= top) why = `Atla (${skip}) en yüksek oydan az değil. Kimse atılmadı.`;
    else outId = tops[0].id;
    this.lastBallot = { day: this.day, votes: [...this.votes.entries()].map(([v, t]) => ({ voter: v, target: t })) };
    this.verdict = { counts: sorted.filter(s => s.c > 0), skip, outId, why, vetoed: false, escalated: { ...this.escalated }, final: false };
    for (const b of this.alive().filter(p => p.isBot && p.role === 'analyst' && p.uses > 0)) if (Math.random() < .5) this.openReport(b);
    if (outId) this.setPhase('veto', DUR.veto, () => this.finishVerdict());
    else this.finishVerdict();
  }

  veto(p) {
    if (this.phase !== 'veto' || p.role !== 'po' || !p.alive || p.uses <= 0) return;
    p.uses--; p.poRevealed = true;
    this.verdict.vetoed = true;
    this.finishVerdict();
  }

  finishVerdict() {
    const v = this.verdict;
    v.final = true;
    if (v.outId && v.vetoed) {
      const po = this.players.find(p => p.poRevealed && p.role === 'po');
      this.sys(`Product Owner ${po ? po.name : ''} veto etti: bu story bu sprintte yok. ${this.byId(v.outId).name} kaldı.`);
      v.why = `${po ? po.name : 'Product Owner'} veto etti. Kimse atılmadı.`;
      v.outId = null;
    } else if (v.outId) {
      const out = this.byId(v.outId);
      out.alive = false;
      v.outRole = this.roleLabel(out); v.outTeam = this.team(out);
      this.sys(`Oylama: ${out.name} repodan atıldı. Rolü: ${this.roleLabel(out)} (${TEAM_NAME[this.team(out)]}).`);
      this.log(out, 'Repodan atıldın. Toplantıyı izleyebilirsin ama konuşamazsın. #mezarlık açık.', 'evil');
      if (out.role === 'pm') { this.pmWinners.push(out.id); this.sys(`${out.name} Project Manager'dı ve oylamayla atılarak kazandı.`); }
      this.inheritance();
    } else this.sys('Oylama: ' + v.why);
    this.setPhase('verdict', DUR.verdict, () => { if (!this.checkWin()) this.startNight(); });
  }

  // ---------- kazanma ----------
  winState() {
    const al = this.alive();
    const evil = al.filter(p => this.isEvil(p)).length;
    const lb = al.some(p => p.role === 'logicbomb');
    if (al.length === 0) return 'none';
    if (lb && (al.length === 1 || (al.length === 2 && evil === 0))) return 'logicbomb';
    if (!lb && evil === 0) return 'town';
    if (!lb && evil >= al.length - evil) return 'evil';
    if (this.day >= 30) return 'none';
    return null;
  }

  checkWin() {
    const w = this.winState();
    if (!w) return false;
    clearTimeout(this.timer);
    this.winTeam = w;
    const winners = new Set(this.pmWinners);
    for (const p of this.players) {
      if (w === 'town' && this.team(p) === 'town') winners.add(p.id);
      if (w === 'evil' && this.team(p) === 'evil') winners.add(p.id);
      if (w === 'logicbomb' && p.role === 'logicbomb' && p.alive) winners.add(p.id);
      if (p.role === 'freelancer' && p.alive) winners.add(p.id);
    }
    this.winners = [...winners];
    const msg = { town: 'Ekip kazandı. Prod kurtarıldı.', evil: 'Sabotaj kazandı. Prod çöktü.', logicbomb: 'Logic Bomb kazandı. Geriye sadece duman kaldı.', none: 'Oyun berabere bitti.' }[w];
    this.sys(msg);
    this.phase = 'over'; this.timerEnd = null;
    this.changed();
    return true;
  }

  backToLobby(by) {
    if (by !== this.hostId || this.phase !== 'over') return;
    this.resetGame();
    this.changed();
  }

  // Sesli sohbet: sadece toplantıda ve hayattaysan konuşabilirsin
  canTalk(p) { return p.alive && p.role != null && this.phase === 'meeting'; }

  // ---------- sohbet ----------
  say(p, text) {
    text = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 200);
    if (!text) return;
    let ch = null;
    if (this.phase === 'lobby' || this.phase === 'over') ch = 'standup';
    else if (!p.alive) ch = 'mezarlik';
    else if (this.phase === 'meeting' || this.phase === 'veto' || this.phase === 'verdict' || this.phase === 'morning') ch = 'standup';
    else if (this.phase === 'night' && this.isEvil(p)) ch = 'sabotaj';
    if (!ch) return;
    this.addChat(p.id, ch, text);
    this.changed();
  }

  // ---------- botlar ----------
  botNight(b) {
    const opts = this.nightOptions(b).filter(o => !o.instant);
    if (!opts.length) return;
    let o = opts.find(x => x.kind === 'hack') || rnd(opts);
    if (b.traitor && Math.random() < .5) o = rnd(opts);
    if (o.kind !== 'hack' && o.kind !== 'plant' && Math.random() < .35) return;
    if (o.kind === 'plant' && opts.some(x => x.kind === 'detonate') && Math.random() < .3) o = opts.find(x => x.kind === 'detonate');
    const ts = shuffle(this.validTargets(b, o.kind));
    if (ts.length < o.targets) return;
    this.acts.set(b.id, { kind: o.kind, targets: ts.slice(0, o.targets).map(t => t.id), pass: false });
  }

  botVote(b) {
    const cands = this.alive().filter(p => p !== b && !(this.isEvil(b) && this.isEvil(p)));
    // Senior bot bildiği sabotajcıya oy verir
    const known = Object.entries(b.known || {}).find(([id, t]) => t === 'evil' && this.byId(+id).alive && !this.isEvil(b));
    if (known) return +known[0];
    // çoğunluğa uyma
    const tally = {}; for (const v of this.votes.values()) if (v !== 'skip') tally[v] = (tally[v] || 0) + 1;
    const lead = Object.entries(tally).sort((x, y) => y[1] - x[1])[0];
    if (lead && cands.some(c => c.id === +lead[0]) && Math.random() < .5) return +lead[0];
    const esc = cands.filter(p => this.escalated[p.id]);
    if (esc.length && Math.random() < .5) return esc[0].id;
    if (!cands.length || Math.random() < .55) return 'skip';
    return rnd(cands).id;
  }

  // ---------- istemciye gidecek görünüm ----------
  viewFor(me) {
    const over = this.phase === 'over';
    const myEvil = me.role && this.isEvil(me);
    const players = this.players.map((p, seat) => ({
      id: p.id, name: p.name, seat, isBot: p.isBot, connected: p.connected, voice: !!p.voice, isHost: p.id === this.hostId, alive: p.alive,
      role: (p.role && (!p.alive || over || p.id === me.id)) ? this.roleLabel(p) : (p.poRevealed ? 'Product Owner' : null),
      team: (p.role && (!p.alive || over || p.id === me.id)) ? this.team(p) : (p.poRevealed ? 'town' : null),
      mate: !!(myEvil && p.id !== me.id && p.role && this.isEvil(p)),
      winner: over && this.winners.includes(p.id),
    }));
    const act = this.acts.get(me.id);
    const mine = me.role ? {
      role: me.role, roleName: this.roleLabel(me), team: this.team(me), traitor: me.traitor,
      desc: ROLES[me.role].desc + (me.traitor ? ' Hainsin: Sabotaj ekibindesin. Her gece ya kendi hamleni yaparsın ya da hacklersin.' : '') + (me.role === 'social' && this.isKiller(me) ? ' Hacker düştü, artık sen hackliyorsun.' : ''),
      color: ROLES[me.role].color,
      uses: me.uses === Infinity ? null : me.uses, maxUses: usesFor(me.role, this.players.length) === Infinity ? null : usesFor(me.role, this.players.length),
      mentor: me.mentorId ? this.byId(me.mentorId).name : null,
      options: this.nightOptions(me).map(o => ({ ...o, valid: o.targets ? this.validTargets(me, o.kind).map(q => q.id) : [] })),
      act: act ? { kind: act.kind, targets: act.targets, pass: act.pass } : null,
      myVote: this.votes.has(me.id) ? this.votes.get(me.id) : null,
      canVeto: this.phase === 'veto' && me.role === 'po' && me.alive && me.uses > 0,
      canReport: me.role === 'analyst' && me.alive && me.uses > 0 && !!this.lastBallot && ['night', 'verdict', 'veto', 'morning', 'meeting'].includes(this.phase),
      report: this.reports[me.id] || null,
      log: this.logs[me.id] || [],
    } : null;
    const chat = this.chat.filter(m => m.ch === 'system' || m.ch === 'standup' || (m.ch === 'sabotaj' && (myEvil || over)) || (m.ch === 'mezarlik' && (!me.alive || over)));
    return {
      code: this.code, meId: me.id, hostId: this.hostId, phase: this.phase, day: this.day,
      timerEnd: this.timerEnd, now: Date.now(), settings: this.settings, minPlayers: MIN_PLAYERS, maxPlayers: MAX_PLAYERS,
      players, mine, chat: chat.slice(-150),
      voteCount: this.phase === 'meeting' ? { voted: this.votes.size, total: this.alive().length } : null,
      escalated: ['meeting', 'veto', 'verdict'].includes(this.phase) ? Object.keys(this.escalated).map(Number) : [],
      morning: this.morning, verdict: this.verdict && (this.phase === 'veto' || this.phase === 'verdict' || this.phase === 'over') ? this.verdict : null,
      winTeam: this.winTeam, error: this.error,
    };
  }

  changed() { if (this.onChange) this.onChange(this); }
  destroy() { clearTimeout(this.timer); this.onChange = null; }
}

module.exports = { Room, MIN_PLAYERS, MAX_PLAYERS, DUR };

'use strict';
// Botlarla çok sayıda hızlandırılmış oyun oynatır; hata, takılma ve kural ihlali arar.
process.env.PHV_TIME_SCALE = process.env.PHV_TIME_SCALE || '0.002';
const assert = require('assert');
const { Room } = require('../server/game');
const { customRoles } = require('../server/roles');

const rnd = a => a[Math.floor(Math.random() * a.length)];
const GAMES = Number(process.argv[2] || 50);

function playOne(i) {
  return new Promise((resolve, reject) => {
    let views = 0;
    const room = new Room('TEST', r => {
      views++;
      // her değişiklikte herkesin görünümü üretilebilmeli ve gizli bilgi sızmamalı
      for (const p of r.players) {
        const v = r.viewFor(p);
        if (r.phase !== 'over' && r.phase !== 'lobby') for (const q of v.players) {
          if (q.id !== p.id && q.alive && q.role && q.role !== 'Product Owner') throw new Error('rol sızdı: ' + q.role);
        }
      }
    });
    const n = 5 + (i % 8);
    const host = room.addPlayer('Host').player;
    host.connected = true;
    for (let k = 1; k < n; k++) room.addBot();
    const mode = i % 4 === 3 ? 'custom' : 'auto';
    if (mode === 'custom') {
      const counts = { hacker: 1, social: n >= 8 ? 1 : 0, senior: 1, qa: 1, po: 1, analyst: 1, intern: 1, config: n >= 9 ? 1 : 0, logicbomb: n >= 10 ? 1 : 0, pm: n >= 11 ? 1 : 0 };
      let sum = Object.values(counts).reduce((a, b) => a + b, 0);
      for (const r of ['junior', 'architect', 'uiux', 'devops', 'scrum', 'lead', 'freelancer']) if (sum < n) { counts[r] = 1; sum++; }
      counts.traitor = i % 2;
      room.setSettings(host.id, { mode: 'custom', counts });
      assert(!customRoles(n, counts).error, customRoles(n, counts).error);
    } else room.setSettings(host.id, { mode: 'auto', traitor: i % 2 === 0, logicBomb: i % 3 !== 0 });
    room.start(host.id);
    assert.strictEqual(room.phase, 'night', 'oyun başlamadı: ' + room.error);
    // ev sahibi rastgele oynar
    const tick = setInterval(() => {
      try {
        if (room.phase === 'night' && host.alive && room.acted !== room.day) {
          room.acted = room.day;
          const opts = room.nightOptions(host);
          if (opts.length && Math.random() < .7) {
            const o = rnd(opts);
            const ts = room.validTargets(host, o.kind).map(q => q.id).sort(() => Math.random() - .5).slice(0, o.targets);
            room.submitAct(host, o.kind, ts);
          } else room.pass(host);
        }
        if (room.phase === 'meeting' && host.alive && Math.random() < .3) {
          const c = room.alive().filter(p => p !== host);
          room.vote(host, Math.random() < .3 || !c.length ? 'skip' : rnd(c).id);
        }
        if (room.phase === 'veto' && host.role === 'po' && Math.random() < .5) room.veto(host);
        if (host.role === 'analyst' && Math.random() < .2) room.openReport(host);
        if (room.phase === 'over') {
          clearInterval(tick); clearTimeout(guard);
          assert(room.winTeam, 'kazanan yok');
          if (room.winTeam === 'none' && process.env.DEBUG) console.log('berabere', room.day, room.alive().map(p => (p.traitor ? 'hain-' : '') + p.role + (p.isBot ? '' : '*')).join(','));
          resolve({ n, winTeam: room.winTeam, day: room.day, views });
          room.destroy();
        }
      } catch (e) { clearInterval(tick); reject(e); }
    }, 2);
    const guard = setTimeout(() => { clearInterval(tick); reject(new Error(`oyun bitmedi: faz=${room.phase} gün=${room.day}`)); }, 60000);
  });
}

(async () => {
  const stats = {};
  for (let i = 0; i < GAMES; i++) {
    const r = await playOne(i);
    stats[r.winTeam] = (stats[r.winTeam] || 0) + 1;
  }
  console.log(`${GAMES} oyun bitti. Kazananlar:`, stats);
})().catch(e => { console.error('HATA:', e); process.exit(1); });

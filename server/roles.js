'use strict';

// Rol tanımları. team: town (Ekip), evil (Sabotaj), neutral (Tarafsız).
// target: gece kaç hedef seçilir (0 = hedefsiz hamle, null = gece hamlesi yok).
const ROLES = {
  senior:     { name: 'Senior Dev',          team: 'town',    target: 1, verb: 'İncele',          color: '#A99CFF', desc: 'Gece bir oyuncunun kodunu review edersin ve hangi takımda olduğunu öğrenirsin. Sosyal Mühendis ve Konfigürasyoncu seni yanıltabilir.' },
  qa:         { name: 'QA Tester',           team: 'town',    target: 1, verb: 'Koru',            color: '#3FCDB8', desc: 'Gece bir oyuncuyu teste alırsın. O gece saldırıya uğrarsa kurtulur. Kendini koruyamazsın.' },
  devops:     { name: 'DevOps',              team: 'town',    target: 1, verb: 'İzle',            color: '#F2C94C', desc: 'Gece bir ofisin loglarını izlersin. Sabah o ofise kimlerin gittiğini görürsün.' },
  uiux:       { name: 'UI/UX Designer',      team: 'town',    target: 1, verb: 'Isı haritası',    color: '#FF8C3B', desc: 'Gece bir oyuncunun ısı haritasını çıkarırsın. Sabah onun kime gittiğini görürsün.' },
  scrum:      { name: 'Scrum Master',        team: 'town',    target: 1, verb: 'Toplantıya çek',  color: '#7FA2FF', desc: 'Gece bir oyuncuyu acil toplantıya çekersin. O gece hamlesi boşa gider.' },
  lead:       { name: 'Tech Lead',           team: 'town',    target: 1, verb: 'Escalate et',     color: '#FF8FB1', desc: 'Bir kez, gece bir oyuncuyu escalate edersin. Ertesi gün oylamaya 2 oyla başlar. Kimin yaptığı gizli kalır. Kendi oyun her zaman 1 sayılır.' },
  junior:     { name: 'Junior Dev',          team: 'town',    target: 0, verb: 'StackOverflow\'a sor', color: '#C2410C', desc: 'Bir kez, gece StackOverflow\'a sorarsın ve kesinlikle sabotajcı olmayan bir oyuncuyu öğrenirsin.' },
  intern:     { name: 'Stajyer',             team: 'town',    target: 1, verb: 'Mentor seç',      color: '#0B8A79', desc: 'Bir gece kendine mentor seçersin. Mentorun düşerse onun rolünü ve takımını devralırsın.' },
  po:         { name: 'Product Owner',       team: 'town',    target: null, verb: 'Veto et',      color: '#A86D12', desc: 'Oyunda bir kez, oylamayla atılacak birini veto edebilirsin. Veto edersen herkes senin PO olduğunu öğrenir.' },
  architect:  { name: 'Software Architect',  team: 'town',    target: 1, verb: 'Mimariyi incele', color: '#5AAAFF', desc: 'Gece bir oyuncuya bakarsın ve iki rol görürsün. Biri onun gerçek rolüdür.' },
  analyst:    { name: 'İş Analisti',         team: 'town',    target: 0, verb: 'Oy raporunu aç',  color: '#5AAAFF', desc: 'Son oylamada kimin kime oy verdiğini görürsün. Gizli oylamanın tek istisnası sensin. Raporu oylama sonucunda ya da gece açabilirsin.' },
  config:     { name: 'Konfigürasyoncu',     team: 'town',    target: 2, verb: 'Takas et',        color: '#9F7AEA', desc: 'Gece iki oyuncu seçersin. O gece birine gelen bütün hamleler diğerine gider. Otomatik modda 10 ve daha kalabalık oyunlarda gelir.' },
  hacker:     { name: 'Hacker',              team: 'evil',    target: 1, verb: 'Hackle',          color: '#FF6E98', desc: 'Her gece bir oyuncuyu hackleyip prod\'dan düşürebilirsin. Hakkın sınırsız.' },
  social:     { name: 'Sosyal Mühendis',     team: 'evil',    target: 1, verb: 'Tuzak kur',       color: '#FF6E98', desc: 'Gece bir oyuncunun git geçmişini sahtelersin. O gece Senior Dev ona bakarsa sabotajcı görür. Hacker düşerse hackleme sana geçer.' },
  pm:         { name: 'Project Manager',     team: 'neutral', target: null, verb: '',             color: '#F2B850', desc: 'Tarafsızsın. Oylamayla repodan atılırsan kazanırsın. Herkesi kendinden şüphelendir.' },
  freelancer: { name: 'Freelancer',          team: 'neutral', target: 0, verb: 'Kendini koru',    color: '#F2B850', desc: 'Tarafsızsın. Oyun bittiğinde hayattaysan kazanırsın. Sınırlı sayıda gece kendini koruyabilirsin.' },
  logicbomb:  { name: 'Logic Bomb',          team: 'neutral', target: 1, verb: 'Bomba göm',       color: '#F2B850', desc: 'Tarafsızsın. Her gece birine bomba gömersin ya da gömdüğün bütün bombaları patlatırsın. Son kalan sen olursan kazanırsın.' },
};

const TEAM_NAME = { town: 'Ekip', evil: 'Sabotaj', neutral: 'Tarafsız' };
const TOWN_ROLES = Object.keys(ROLES).filter(k => ROLES[k].team === 'town');
const NEUTRAL_ROLES = ['pm', 'freelancer', 'logicbomb'];
// özel modda oda kurucusunun sayısını seçebildiği kalemler
const CUSTOM_KEYS = [...Object.keys(ROLES), 'traitor'];

// Hak sınırları oyuncu sayısına göre (Burak'la kararlaştırılan tablo)
function usesFor(role, n) {
  switch (role) {
    case 'hacker': case 'logicbomb': return Infinity;
    case 'senior': case 'qa': case 'social': return n >= 11 ? 3 : 2;
    case 'freelancer': return n >= 11 ? 2 : 1;
    case 'devops': case 'uiux': case 'scrum': return n >= 9 ? 2 : 1;
    case 'architect': case 'config': return 1;
    case 'analyst': return n >= 11 ? 2 : 1;
    case 'junior': case 'intern': case 'po': case 'lead': return 1;
    default: return 0;
  }
}

const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

// Otomatik mod: oyuncu sayısına göre rol listesi. traitor: bir Ekip rolü gizlice hain olur.
function autoRoles(n, { traitor = false, logicBomb = true } = {}) {
  const evil = n <= 6 ? 1 : n <= 10 ? 2 : 3;
  const neutral = n >= 11 ? 2 : n >= 8 ? 1 : 0;
  const list = ['hacker'];
  let traitors = 0;
  for (let i = 1; i < evil; i++) {
    if (traitor && traitors === 0) traitors++;
    else list.push('social');
  }
  const pool = shuffle(NEUTRAL_ROLES.filter(r => logicBomb || r !== 'logicbomb'));
  list.push(...pool.slice(0, neutral));
  const townCount = n - list.length;
  const extra = shuffle(TOWN_ROLES.filter(r => !['senior', 'qa'].includes(r) && (r !== 'config' || n >= 10)));
  const town = ['senior', 'qa', ...extra].slice(0, townCount);
  while (town.length < townCount) town.push(shuffle(['devops', 'uiux', 'architect'])[0]);
  return { roles: [...list, ...town], traitors };
}

// Özel mod doğrulaması. counts: { roleKey: sayı, traitor: sayı }
function customRoles(n, counts) {
  const roles = []; let traitors = 0;
  for (const k of CUSTOM_KEYS) {
    const c = Math.max(0, Math.min(12, parseInt(counts[k], 10) || 0));
    if (k === 'traitor') traitors = c; else for (let i = 0; i < c; i++) roles.push(k);
  }
  if (roles.length !== n) return { error: `Rol sayısı oyuncu sayısına eşit olmalı (${roles.length}/${n}).` };
  if (!roles.includes('hacker')) return { error: 'En az bir Hacker olmalı.' };
  const townCount = roles.filter(r => ROLES[r].team === 'town').length;
  if (traitors > townCount) return { error: 'Hain sayısı Ekip rollerinden fazla olamaz.' };
  const evil = roles.filter(r => ROLES[r].team === 'evil').length + traitors;
  if (evil >= n - evil) return { error: 'Sabotajcılar oyunun başında çoğunlukta olamaz.' };
  return { roles, traitors };
}

module.exports = { ROLES, TEAM_NAME, TOWN_ROLES, NEUTRAL_ROLES, CUSTOM_KEYS, usesFor, autoRoles, customRoles, shuffle };

'use strict';

// Türkçe ek: ünlü uyumu ve kaynaştırma harfi. sfx('Kaan','in') -> "'ın", sfx('Ayşe','e') -> "'ye"
function sfx(name, t) {
  const v = (name.toLocaleLowerCase('tr').match(/[aeıioöuü]/g) || ['e']).pop();
  const endsV = /[aeıioöuüAEIİOÖUÜ]$/.test(name);
  const four = { a: 'ı', ı: 'ı', o: 'u', u: 'u', e: 'i', i: 'i', ö: 'ü', ü: 'ü' }[v];
  const two = 'aıou'.includes(v) ? 'a' : 'e';
  if (t === 'in') return "'" + (endsV ? 'n' : '') + four + 'n';
  if (t === 'i') return "'" + (endsV ? 'y' : '') + four;
  return "'" + (endsV ? 'y' : '') + two;
}
const ek = (name, t) => name + sfx(name, t);

module.exports = { sfx, ek };

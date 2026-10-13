const fs = require('fs');
const p = process.argv[2];
const out = process.argv[3];
const raw = fs.readFileSync(p, 'utf8');
const j = JSON.parse(raw);
const rows = [];
for (const side of ['playerHexes', 'enemyHexes']) {
  const obj = j[side];
  for (const id of Object.keys(obj)) {
    const needle = '"' + id + '":{';
    const at = raw.indexOf(needle);
    rows.push({ side, id, charOffset: at, rarity: obj[id].rarity, bytesBefore: Buffer.byteLength(raw.slice(0, at)) });
  }
}
const P = rows.filter(r => r.side === 'playerHexes');
const E = rows.filter(r => r.side === 'enemyHexes');
console.log('total records: ' + rows.length + ' (player ' + P.length + ' + enemy ' + E.length + ')');
console.log('raw chars: ' + raw.length + '  raw bytes: ' + Buffer.byteLength(raw));
console.log('format  key char offset: ' + raw.indexOf('"format":'));
console.log('rarities key char offset: ' + raw.indexOf('"rarities":'));
console.log('playerHexes key char offset: ' + raw.indexOf('"playerHexes":'));
console.log('enemyHexes  key char offset: ' + raw.indexOf('"enemyHexes":'));
console.log('player span chars ' + Math.min(...P.map(r => r.charOffset)) + ' .. ' + Math.max(...P.map(r => r.charOffset)));
console.log('enemy  span chars ' + Math.min(...E.map(r => r.charOffset)) + ' .. ' + Math.max(...E.map(r => r.charOffset)));
console.log('missing (offset -1): ' + rows.filter(r => r.charOffset < 0).map(r => r.id).join(', ') || 'none');
fs.writeFileSync(out, rows.map(r => [r.side, r.id, r.charOffset, r.bytesBefore, r.rarity].join('\t')).join('\n') + '\n');
console.log('wrote ' + out);

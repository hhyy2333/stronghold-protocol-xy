const fs=require('fs');
const [,,p]=process.argv;
const txt=fs.readFileSync(p,'utf8');
const j=JSON.parse(txt);
const want={ test:'node --test', golden:'node tools/golden.mjs', 'golden:update':'node tools/golden.mjs --update' };
// 按原顺序在 "dev" 之后插回
const s=j.scripts, out={};
for(const k of Object.keys(s)){
  out[k]=s[k];
  if(k==='dev'){ for(const [kk,vv] of Object.entries(want)){ if(!(kk in s)) out[kk]=vv; } }
}
for(const [kk,vv] of Object.entries(want)){ if(!(kk in out)) out[kk]=vv; }
j.scripts=out;
fs.writeFileSync(p, JSON.stringify(j,null,2)+'\n','utf8');
console.log('恢复后 scripts 数:', Object.keys(j.scripts).length);
console.log(Object.keys(j.scripts).join(', '));

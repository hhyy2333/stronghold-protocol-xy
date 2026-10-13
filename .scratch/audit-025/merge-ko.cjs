const fs=require('fs');
const [,,ours,base,off,out]=process.argv;
const J=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const o=J(ours), b=J(base), f=J(off);
const merged={};
// ours 键顺序优先，保留全部自有键
for(const k of Object.keys(o)){
  if(k==='_meta'){ merged[k]=o[k]; continue; }
  if(k in f && f[k]!==b[k] && o[k]===b[k]) merged[k]=f[k];   // 官方改了、我们没改 -> 采纳官方
  else merged[k]=o[k];
}
const added=[];
for(const k of Object.keys(f)){
  if(k==='_meta'||k in merged) continue;
  merged[k]=f[k]; added.push(k);
}
fs.writeFileSync(out, JSON.stringify(merged,null,2)+'\n','utf8');
console.log('采纳官方修正:', Object.keys(o).filter(k=>k!=='_meta'&&k in f&&f[k]!==b[k]&&o[k]===b[k]).length);
console.log('新增官方键:', added.length, '->', added.join(' / '));
console.log('保留自有键:', Object.keys(o).filter(k=>!(k in f)).length);

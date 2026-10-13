const fs=require('fs');
const [,,oursP,offP,outP]=process.argv;
const ours=JSON.parse(fs.readFileSync(oursP,'utf8'));
const off=JSON.parse(fs.readFileSync(offP,'utf8'));
const groups={...ours.groups};
let added=0;
for(const [k,v] of Object.entries(off.groups)){
  if(!(k in groups)){ groups[k]=v; added++; }
}
const out={...ours, groups};
// count 字段重算：统计所有 group 里的条目总数
let n=0; for(const g of Object.values(groups)) n+=Object.keys(g).length;
if(typeof out.count==='number') out.count=n;
fs.writeFileSync(outP, JSON.stringify(out,null,2)+'\n','utf8');
console.log('新增 group:', added, '| group 总数:', Object.keys(groups).length, '| count 重算为:', n);
console.log('自有 group 保留:', ['hextech/tier','char/char_9002_yana','hextech/audio','hextech/item'].filter(k=>k in groups).join(', '));

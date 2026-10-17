cd "C:\Users\hhyyl\Downloads\Stronghold-Protocol-v0.2.1\Stronghold-Protocol-Forge-协议源石版/app" || exit 1
echo '=== 谁在生成增量帧 ==='
grep -rn "delta: true\|viewsDelta\|publicDelta" server/ | head -10
echo
echo '=== 客户端合并规则的文档（matchDelta.js 头部）==='
sed -n '100,145p' public/js/matchDelta.js

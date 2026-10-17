cd "C:\Users\hhyyl\Downloads\Stronghold-Protocol-v0.2.1\Stronghold-Protocol-Forge-协议源石版/app" || exit 1
echo '=== 增量合并函数 ==='
grep -n "export function applyPublic\|export const applyPublic" public/js/matchDelta.js
sed -n "$(grep -n 'applyPublic' public/js/matchDelta.js | head -1 | cut -d: -f1),+24p" public/js/matchDelta.js
echo '=== harness 里有没有现成的合并 ==='
grep -n "applyPublic\|m.public" test/match/harness.js | head -8

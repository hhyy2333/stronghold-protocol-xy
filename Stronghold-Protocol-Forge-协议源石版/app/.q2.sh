cd "C:\Users\hhyyl\Downloads\Stronghold-Protocol-v0.2.1\Stronghold-Protocol-Forge-协议源石版/app" || exit 1
echo '=== harness: lastBc 定义 ==='
grep -n "lastBc" test/match/harness.js | head -5
echo '=== harness imports ==='
sed -n '1,20p' test/match/harness.js

cd "C:\Users\hhyyl\Downloads\Stronghold-Protocol-v0.2.1\Stronghold-Protocol-Forge-协议源石版\app" || exit 1
echo '=== viewsDelta 头部 ==='
sed -n '1,50p' server/viewsDelta.js
echo '=== 常量 ==='
grep -rn "PUBLIC_FULL_EVERY\s*=" server/ shared/ | head -3
echo '=== isEmptyDelta / 顶层键规则 ==='
grep -n -A12 "export function isEmptyDelta" server/viewsDelta.js | head -16

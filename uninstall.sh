#!/usr/bin/env bash
# 卸载 dsh-computer-use（移除 home patch 层注册 + 插件链接）。
set -euo pipefail

DSH_HOME="${DSH_HOME:-$HOME/Library/Application Support/harness-desktop/dsh-home}"
PATCH="$DSH_HOME/cordis.patch.yml"

echo "== dsh-computer-use uninstall =="

if [ -f "$PATCH" ]; then
  python3 - "$PATCH" <<'PY'
import sys, re
p = sys.argv[1]
s = open(p).read()
# 移除 install.sh 生成的块（从 '# dsh-computer-use 用户级注册' 到下一个顶层条目前）
before = s
s = re.sub(r'\n?# dsh-computer-use 用户级注册（install\.sh 生成）\n(?:- insert:\n(?:[ \t]+.*\n?)*)', '\n', s, count=1)
s = s.strip('\n') + '\n'
open(p, 'w').write(s)
print('  [ok] 已从', p, '移除注册块' if s != before else '（未找到注册块）')
PY
else
  echo "  [skip] 无 patch 文件"
fi

rm -f "$DSH_HOME/profiles/web/node_modules/dsh-computer-use"
echo "== 卸载完成，请重启 harness-desktop 生效 =="

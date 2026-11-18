#!/bin/sh
# 사용법: ./release.sh 1.1.1
# version.json / app.js의 APP_VERSION / index.html의 app.js?v= / sw.js의 CACHE 이름을 한 번에 올립니다.
set -e
V="$1"
if [ -z "$V" ]; then echo "사용법: ./release.sh 1.1.1"; exit 1; fi
VER="v$V"
printf '{"version":"%s"}\n' "$VER" > version.json
python3 - "$VER" "$V" <<'PY'
import sys, io, re
ver, plain = sys.argv[1], sys.argv[2]
def sub(path, pat, rep):
    s = io.open(path, encoding='utf-8').read()
    s2 = re.sub(pat, rep, s)
    if s == s2: print('경고: 패턴을 찾지 못했습니다 ->', path)
    io.open(path, 'w', encoding='utf-8').write(s2)
sub('app.js', r'const APP_VERSION = "v[^"]+";', 'const APP_VERSION = "%s";' % ver)
sub('index.html', r'app\.js\?v=[0-9.]+', 'app.js?v=' + plain)
sub('sw.js', r"const CACHE = 'sk-guide-[0-9.]+';", "const CACHE = 'sk-guide-%s';" % plain)
PY
echo "버전을 $VER 로 올렸습니다. 이제 git add/commit 또는 파일 업로드 후 앱에서 새로고침하세요."

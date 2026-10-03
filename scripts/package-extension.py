"""Package the same static frontend as a foreground-tab Chrome extension."""
import json
import shutil
import zipfile
from pathlib import Path

root = Path(__file__).resolve().parent.parent
extension = root / 'extension'
extension.mkdir(exist_ok=True)
assets = ['index.html', 'styles.css', 'app.js', 'audio.js']
for asset in assets:
    shutil.copyfile(root / 'dist' / asset, extension / asset)
manifest = {
    'manifest_version': 3,
    'name': 'Fishcon — 보이스 스튜디오',
    'version': '1.0.0',
    'description': 'API 키를 저장하지 않고 Fish Audio로 직접 요청하는 음성 제작 도구',
    'permissions': ['clipboardWrite'],
    'host_permissions': ['https://api.fish.audio/*'],
    'action': {'default_title': 'Fishcon', 'default_popup': 'launch.html'},
    'options_page': 'index.html',
    'content_security_policy': {'extension_pages': "script-src 'self'; object-src 'none'; connect-src https://api.fish.audio; media-src 'self' blob:; base-uri 'none'"},
}
(extension / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
(extension / 'launch.html').write_text('''<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>Fishcon</title><link rel="stylesheet" href="launch.css"></head><body><strong>fishcon</strong><p>음성이 끊기지 않도록 새 탭에서 작업합니다.</p><a href="index.html" target="_blank" rel="noopener">스튜디오 열기</a></body></html>''')
(extension / 'launch.css').write_text('body{width:250px;padding:20px;font:14px/1.7 -apple-system,sans-serif;color:#26314c}strong{font-size:24px}p{color:#69748a}a{display:block;background:#394bea;color:white;text-decoration:none;padding:10px;border-radius:7px;text-align:center}')
with zipfile.ZipFile(root / 'dist' / 'fishcon-extension.zip', 'w', zipfile.ZIP_DEFLATED) as archive:
    for name in assets + ['manifest.json', 'launch.html', 'launch.css']:
        archive.write(extension / name, name)
print('Created extension/ and dist/fishcon-extension.zip')

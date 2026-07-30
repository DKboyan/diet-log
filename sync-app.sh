#!/bin/bash
# 把 饮食记录App 的网页内容同步到桌面的「饮食记录.app」里
SRC="$(cd "$(dirname "$0")" && pwd)"
DEST="/Users/boyanjiang/Desktop/饮食记录.app/Contents/Resources"
if [ ! -d "$DEST" ]; then
  echo "找不到 饮食记录.app，请确认它还在桌面上" >&2
  exit 1
fi
rsync -a "$SRC/index.html" "$SRC/styles.css" "$SRC/app.js" \
  "$SRC/manifest.json" "$SRC/sw.js" "$SRC"/icon-*.png "$DEST/"
codesign --force -s - "/Users/boyanjiang/Desktop/饮食记录.app" 2>/dev/null
echo "已同步到 饮食记录.app（重新打开 App 或按 ⌘R 生效）"

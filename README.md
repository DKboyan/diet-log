# 饮食记录 App

每天记录吃了什么（热量大卡 + 蛋白质克数）和体重，帮助控制饮食。

## 使用

- **Mac**：双击桌面的 **饮食记录.app**
- **iPhone**：Safari 打开 <https://dkboyan.github.io/diet-log/> → 分享按钮 → 「添加到主屏幕」。之后从主屏幕图标打开，全屏、离线都能用，数据存在手机本地
- 手机和电脑的数据各自独立，需要搬数据时用 设置 → 导出备份（JSON）/ 导入备份

## 发布

代码推到 GitHub（`DKboyan/diet-log`，main 分支）即自动更新线上版：

```bash
git add -A && git commit -m "..." && git push
```

手机端已装的 PWA 会在下次联网打开时自动拉新版（Service Worker 后台更新，再下次打开生效）。

- **记录页**：输入食物名、热量、蛋白质，选餐别（早/午/晚/加餐，按时间自动选好）；顶部环形图显示今日进度；**食物库**——先把常吃的食物按「每100克」或「每份」存好热量蛋白质，记录时点一下、填吃了多少，热量自动算（记住上次的量）；常用食物点一下直接记入；点条目可修改，删除后 5 秒内可撤销；空白的一天可以一键复制前一天的记录
- **体重页**：记每天体重（可补记过去的日期），看 30/90 天趋势图、7 日均值、30 天变化、BMI
- **统计页**：7 日平均热量/蛋白质、蛋白质达标天数、连续记录天数、最近 14 天热量柱状图
- **设置页**：改每日热量/蛋白质目标、目标体重、身高；导出 JSON 备份 / CSV 表格；导入备份

## 数据存哪里

双保险：

1. `~/Library/Application Support/饮食记录/data.json`（每次改动自动落盘）
2. WKWebView 的 localStorage

两份数据带版本号 `_rev`，启动时取较新的一份。重装/替换 .app 不会丢数据。

## 开发

- 源码就是 `index.html` + `styles.css` + `app.js`，纯前端无依赖
- 改完跑 `./sync-app.sh` 同步到桌面的 .app（和 physics-lab 同一套模式）
- 本地预览：Claude Code 里 launch.json 的 `diet-app` 配置（端口 8930）
- 原生壳源码在 `native/main.swift`，重编译：
  `cd native && swiftc -O main.swift -o launch -framework Cocoa -framework WebKit`
  然后把 `launch` 拷进 `饮食记录.app/Contents/MacOS/` 并重新 `codesign --force -s -`
- 图标：`native/icon.swift` 生成 PNG，再 sips + iconutil 打包 icns

## 图表配色

用的是 dataviz 技能的参考调色板（热量=蓝 #2a78d6/#3987e5，蛋白质=橙 #eb6834/#d95926，
明暗双模式，已跑过 validate_palette.js 全项通过）。

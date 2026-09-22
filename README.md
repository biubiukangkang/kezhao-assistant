# 课照助手（Kezhao Assistant）

> 拍完板书不用管：打开即已按课程、按日期归档好的课堂照片助手

<!-- TODO: 放一张主界面截图/GIF -->

大学生拍板书/PPT，一学期几百张混在相册里，考前找不到。课照助手把「照片拍摄时间」和「课表」对齐——拍完自动归入对应课程，复习时来课程库找，整整齐齐。安卓 APP（Capacitor），本地优先，照片不上传。

另有参赛网页版（QMuse 平台构建）：https://qmuse.cn/app/2147940046996490

## ✨ 功能特性

- **拍照即归档**：调系统相机拍摄，按拍摄时间 × 课表自动识别课程，第一张确认后连拍免打扰；课间/课前拍摄有专门的方向判定
- **课表引擎**：周视图管理（任意周次组合/单双周/冲突提醒）；教务 .xls/.xlsx 导入、文本粘贴导入、**AI 识别导入**（课表截图丢进去，格式不挑）
- **QQ 空间式课程相册**：日期分组动态流、备注提醒、星标重点板书、沉浸查看器、待分类批量改派
- **数据主权**：IndexedDB 本地优先；系统相册按课程子文件夹自动镜像（免权限）；流式 JSON 整包备份/原子恢复；回收站 30 天可恢复；照片批量导出/分享
- **应用内更新**：GitHub Release 检查更新，覆盖安装数据全保留
- 适配深色模式、刘海安全区；锁定字体缩放，系统大字体不破版

## 🛠 技术栈

`React 19` · `Vite 7` · `TanStack Router` · `Tailwind 4` · `IndexedDB (idb)` · `exifr` · `Capacitor 8`（安卓壳 + 原生 MediaStore/相机/HTTP 插件）

架构与设计决策见 [docs/技术方案.md](docs/技术方案.md)，需求演进见 [docs/PRD.md](docs/PRD.md)，踩坑记录见 [docs/踩坑日志.md](docs/踩坑日志.md)。

## 🚀 快速开始

### 安卓 APP（推荐）

从 [Releases](https://github.com/biubiukangkang/kezhao-assistant/releases) 下载最新 APK 安装即可；后续在应用内「设置 → 检查更新」或启动时自动提醒，**覆盖安装数据全保留**。

### 从源码构建

```bash
git clone https://github.com/biubiukangkang/kezhao-assistant.git
cd kezhao-assistant
npm install                 # 国内网络可加 --registry=https://registry.npmmirror.com
cp .env.example .env.local  # 填入 AI 接口（可选，仅 AI 课表导入需要）
npm run dev                 # 网页版开发（http://127.0.0.1:5173）
npm run check && npm run build
```

安卓 APK（需 JDK 21 + Android SDK）：

```bash
npm run app:debug    # debug APK
npm run app:release  # 自签 release APK + version.json（android/app/build/outputs/apk/release/）
```

- 签名文件 `android/keystore.properties` 与 `*.keystore` 不入库；自行构建请生成自己的签名（**签名丢失将无法覆盖升级**）
- AI 课表识别走任意 OpenAI 兼容视觉模型（`.env.local` 三个变量，见 `.env.example`），密钥只存在你本机构建产物里，仓库不含任何密钥

## 🤝 贡献约定

改代码前读 `AGENTS.md`（项目约定）与 `docs/技术方案.md`：路由保持平铺、根布局不挂全局组件、照片一律经 `lib/archive.ts` 入库、安卓 `.java` 源文件 ASCII-only。

## 📄 许可证

MIT

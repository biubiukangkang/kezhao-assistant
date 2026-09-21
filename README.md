# 课照助手

大学生拍完板书/PPT，照片按课表时间自动归档到对应课程相册——拍完什么都不用管，复习时一搜一个准。

支付宝「智能体涌现大赛」参赛作品，基于 QMuse 平台构建。

**线上地址**：https://qmuse.cn/app/2147940046996490

## 功能一览

- 拍照即归档：全屏相机（前后摄翻转、连拍同批），按拍摄时间自动匹配课表归入课程
- 课表：超级课程表式周视图；周次任意勾选组合；支持教务系统导出的 .xls/.xlsx 文件与文本粘贴导入
- 课程库：搜索、缩略图预览、长按课程卡管理（编辑/删除）、待分类显式入口与多选批量移动
- 相册：QQ 空间式动态流（备注醒目在上、图在下）、沉浸查看器（星标/移动/改时间/删除）
- 数据：照片压缩入库、文件夹镜像（Chromium）、照片出口（查看器/批量「保存或分享」到手机相册）、回收站（删除保留 30 天可恢复）、备份提醒 + 恢复前覆盖预览、JSON 整包备份/恢复、一键演示数据

## 本地开发

```bash
npm install        # 推荐 cnpm install
npm run check      # tsr generate + oxlint + tsc
npm run dev        # http://localhost:5173
npm run build      # 生产构建
```

部署到 QMuse：`npm run build` 后执行 `qmuse import .`；平台上的"发布"动作在 QMuse 网页端完成。

## 安卓 APP（Capacitor，个人自用线）

参赛网页版已冻结；同一份代码可构建安卓 APP（`android/` 工程，包名 `cn.kezhao.assistant`）：

```bash
npm run app:sync     # web 构建 + 同步进安卓工程
npm run app:debug    # 出 debug APK
npm run app:release  # 出自签 release APK（android/app/build/outputs/apk/release/）
```

- 构建需要 **JDK 21**（本机在 `C:\Java\jdk-21`）：`JAVA_HOME="C:\Java\jdk-21" npm run app:debug`
- 签名：`android/keystore.properties` + `android/kezhao-release.keystore`（均已 gitignore，**丢了就无法覆盖升级只能卸载重装**，密码备份在 `~/.kezhao-keystore-pass.txt`）
- 原生能力（v1.1）：拍照调系统相机（原生画质/对焦/变焦）；照片经 MediaStore 自动写入公共 `Pictures/课照助手/<课程名>/`（免权限、卸载不清，待分类独立子文件夹，旧布局升级自动迁移）；设置页一键打开相册文件夹；备份导出走系统分享面板；网页端行为不变
- 网页版数据迁移：网页版设置页导出 JSON 备份 → 传入手机 → APP「设置 → 数据 → 从备份恢复」

## 文档

- [docs/PRD.md](docs/PRD.md) — 产品需求与设计规范（含「不反人性」负面清单）
- [docs/技术方案.md](docs/技术方案.md) — 架构、数据模型、匹配算法、平台约束（**改代码前先读**）
- [docs/踩坑日志.md](docs/踩坑日志.md) — QMuse 校验拦截、Windows/Vite、浏览器自动化踩坑

## 约定

改代码前读 `AGENTS.md`（项目约定）与 `docs/技术方案.md`。路由保持平铺、根布局不挂全局组件、照片一律经 `lib/archive.ts` 入库。

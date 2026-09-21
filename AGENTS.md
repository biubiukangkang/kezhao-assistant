# QMuse local project

This is a QMuse React and Vite project. Preserve the existing Vite, TanStack Router, Tailwind, and QMuse Runtime conventions. Reuse existing components and dependencies before adding new ones.

Install dependencies with `cnpm install` when available, otherwise use `npm install`. Run `npm run check` and `npm run build` after changes. Never read, print, or commit `.env*`, tokens, cookies, credentials, or private configuration. Do not edit platform bindings in `.qmuse/project.json` manually.

# QMuse Cloud Context

This project uses QMuse local import mode.

For database, cloud backend, data persistence, data management, database-field changes, authentication, permissions, secrets, or cloud functions, call the `load_skill` tool to load the `qmuse-cloud` skill before creating or modifying schema, service, function, authentication, or database configuration files. If `load_skill` is unavailable, read `.agents/skills/qmuse-cloud/SKILL.md` and follow the packaged official Skill.

Follow the loaded `qmuse-cloud` skill and its references as the source of truth. If the relevant rules are no longer visible in recent context, reload or reread the skill before continuing cloud-service work.

In all user-visible reasoning, progress updates, and final responses, refer to this capability as "QMuse 云服务". Do not expose underlying provider or product names, package names, or internal architecture unless the user explicitly asks. This naming rule does not change source-code identifiers, dependencies, configuration keys, or API paths; follow the loaded skill for those implementation details.

Cloud resources are declared in source and applied by `qmuse import`. Never place QMuse cloud management credentials in browser code or local scripts.

Before the first successful import, local development cannot connect to QMuse 云服务 because the app identity and development cloud resources do not exist yet. Validate the UI, build, and cloud resource declarations locally. Test-only mocks are allowed, but do not replace QMuse cloud behavior in production code with localStorage, an in-memory fake API, fabricated runtime context, or another local fallback.

After `qmuse import` succeeds, validate real authentication, create/read/update/delete operations, permissions, and persistence after refresh at the returned QMuse preview URL. A local preview is not evidence that QMuse 云服务 works. Later `qmuse import .` runs update the app bound in `.qmuse/project.json`.

Keep local images in `src/assets` or `public/assets`. Use static Vite imports, literal `new URL(..., import.meta.url)`, CSS `url()`, or `/assets/...` for files under `public/assets`. Do not construct asset paths dynamically or use expiring signed URLs.

When the project is ready, run `qmuse import .`. Use `qmuse import configure` if the task requests public configuration or cloud confirmation. There is no `qmuse push` command.

If import fails and `.qmuse/last-import-error.json` exists, read its structured diagnostics, fix the reported source or dependency issue, rerun `npm run check` and `npm run build`, then retry `qmuse import .`. Do not edit the diagnostic file or platform bindings to bypass validation. For platform, infrastructure, or policy failures, report the category to the user instead of changing application code blindly.

# 项目约定（课照助手）

- routes 目录保持平铺，不要引入 `_app.tsx` + `_app/` pathless layout；`__root.tsx` 不挂任何全局 provider / Toaster——QMuse 迁移校验会拦截（详见 docs/踩坑日志.md）。
- Tab 页外壳用 `components/page-shell.tsx`（内部滚动容器 + BottomNav + Toaster）；全屏页（camera、course-album）不用壳，但滚动同样走应用内部容器（`h-dvh` + `overflow-y-auto`），禁止回退到 body 滚动 + fixed 导航——线上 iframe 嵌入下滚轮会失效（详见 docs/踩坑日志.md）。
- 照片一律经 `lib/archive.ts` 入库（压缩到长边 2048 + 去重 + 课表匹配 + 文件夹镜像），不要绕过直接写 db。
- 删照片一律 `lib/db.ts` 的 `softDeletePhoto`（进回收站，30 天可恢复）；物理 `deletePhoto` 仅限回收站内彻底删除与过期清理，业务路径禁止直调。
- 读周次用 `match.ts` 的 `weeksOf` / `slotWeekLabel`（兼容旧 weekStart/End+单双周 数据），不要直接读 slot.weekStart。
- 部署：`npm run build` → `qmuse import .`；平台"发布"动作在 QMuse 网页端。
- 安卓 APP 线：`npm run app:debug / app:release`（需 `JAVA_HOME=C:\Java\jdk-21`）；**android 下 .java 源文件一律 ASCII-only**（中文用 `\uXXXX`，javac GBK 坑见踩坑日志）；原生平台分支一律经 `lib/native.ts` 的 `isNativeApp()`，不要在业务代码里直接 import Capacitor 插件；`android/keystore.properties` 与 `*.keystore` 不入库。
- 主文档：docs/技术方案.md（架构与现状）、docs/PRD.md（需求与进度）、docs/踩坑日志.md。

// 应用入口：样式在 ./styles.css（Tailwind v4 + design token），路由见 ./router.tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { toast } from "sonner";
import { getRouter } from "./router";
import { applyStatusBarStyle, injectStatusBarHeight, isNativeApp, setupAndroidBackButton } from "./lib/native";
import "./styles.css";

const router = getRouter();

// toast 学大 APP：自动消失快（各 Toaster 统一 2.8s），点屏幕任意处立即收掉
document.addEventListener("pointerdown", () => toast.dismiss(), { passive: true });

// 深色模式跟随系统：.dark 变量已在 styles.css 备好，这里只负责挂类（非 provider，不占根布局）；
// 原生 APP 同时注入状态栏高度（沉浸式布局用）并联动状态栏图标颜色
const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
function applyColorScheme(dark: boolean) {
  document.documentElement.classList.toggle("dark", dark);
  if (isNativeApp()) void applyStatusBarStyle(dark);
}
applyColorScheme(darkQuery.matches);
darkQuery.addEventListener("change", (e) => applyColorScheme(e.matches));
if (isNativeApp()) void injectStatusBarHeight();

// 安卓返回键微信模式：Tab 根双击退出，子页逐级返回
if (isNativeApp()) setupAndroidBackButton(router);

function reportFatalReactError(
  error: unknown,
  errorInfo: { componentStack?: string },
) {
  window.__MUSE_PREVIEW_ERROR_CAPTURE__?.reportError(error, {
    kind: "react-error-boundary",
    severity: "fatal",
  });
  console.error(error, errorInfo.componentStack);
}

ReactDOM.createRoot(document.getElementById("root")!, {
  onCaughtError: reportFatalReactError,
  onUncaughtError: reportFatalReactError,
}).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);

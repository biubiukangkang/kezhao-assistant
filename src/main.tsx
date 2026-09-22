// 应用入口：样式在 ./styles.css（Tailwind v4 + design token），路由见 ./router.tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { getRouter } from "./router";
import { isNativeApp, setupAndroidBackButton } from "./lib/native";
import "./styles.css";

const router = getRouter();

// 深色模式跟随系统：.dark 变量已在 styles.css 备好，这里只负责挂类（非 provider，不占根布局）
const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
function applyColorScheme() {
  document.documentElement.classList.toggle("dark", darkQuery.matches);
}
applyColorScheme();
darkQuery.addEventListener("change", applyColorScheme);

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

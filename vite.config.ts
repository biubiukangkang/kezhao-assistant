import { defineConfig } from '@qmuse/vite-config';

// @qmuse/vite-config already includes the following — do NOT add or register
// them again, or the app may break because of duplicate plugins:
//   - TanStack Router
//   - React
//   - Tailwind CSS
//   - TypeScript path aliases
//
// Add only genuinely additional configuration through defineConfig({ ... }).
export default defineConfig({
  // Windows 下默认文件监听会卡死（改代码后仍吐旧模块），改用轮询
  server: {
    watch: {
      usePolling: true,
      interval: 300,
    },
  },
});

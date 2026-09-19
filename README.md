# QMuse local project

Install and verify the project:

```bash
cnpm install
npm run check
npm run build
```

`cnpm install` is recommended. Use `npm install` when cnpm is unavailable.

Develop with Codex or another coding agent. Read `AGENTS.md` before changing the project. Tools that do not discover repository skills automatically should also read `.agents/skills/qmuse-cloud/SKILL.md` when cloud capabilities are involved.

Import the project with:

```bash
qmuse login
qmuse space list
qmuse space use <spaceId>
qmuse import .
```

The same `qmuse import .` command creates an app on first use and adds a version to the bound app on later uses.
When an import fails, let the coding agent read `.qmuse/last-import-error.json`, fix source issues, and run the same import command again.

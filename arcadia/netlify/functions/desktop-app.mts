import type { Config } from "@netlify/functions";
import { existsSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { findRoot, walk, zip } from "../lib/zip.mts";

// Builds a ready-to-run desktop app (Electron) for Windows, macOS and Linux.
// The game files are served locally inside the app; co-op requests are proxied to the live site.

const SITE = "https://admirable-rugelach-6de6cf.netlify.app";

const PACKAGE_JSON = {
  name: "arcadia-desktop",
  productName: "АРКАДИЯ Эон Радости",
  version: "1.0.0",
  description: "АРКАДИЯ: Эон Радости — настольная версия",
  main: "main.js",
  private: true,
  scripts: {
    start: "electron .",
    dist: "electron-builder",
    "dist:win": "electron-builder --win",
    "dist:mac": "electron-builder --mac",
    "dist:linux": "electron-builder --linux",
  },
  devDependencies: { electron: "^33.0.0", "electron-builder": "^25.1.8" },
  build: {
    appId: "app.netlify.arcadia",
    productName: "Arcadia",
    files: ["main.js", "game/**/*", "icon.png"],
    win: { target: ["nsis", "portable"], icon: "icon.png" },
    mac: { target: "dmg", icon: "icon.png", category: "public.app-category.role-playing-games" },
    linux: { target: "AppImage", icon: "icon.png", category: "Game" },
    nsis: { oneClick: false, allowToChangeInstallationDir: true, createDesktopShortcut: true },
  },
};

const MAIN_JS = `// АРКАДИЯ — настольная версия (Electron)
const { app, BrowserWindow, protocol, net, shell } = require("electron");
const path = require("path");
const { pathToFileURL } = require("url");

const SITE = ${JSON.stringify(SITE)}; // сервер сетевой игры
const GAME = path.join(__dirname, "game");

protocol.registerSchemesAsPrivileged([
  { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

function createWindow() {
  const win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 360, minHeight: 500,
    backgroundColor: "#0a0018", title: "АРКАДИЯ: Эон Радости",
    icon: path.join(__dirname, "icon.png"), autoHideMenuBar: true,
  });
  win.setMenuBarVisibility(false);
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: "deny" }; });
  win.webContents.on("before-input-event", (e, input) => {
    if (input.type !== "keyDown") return;
    if (input.key === "F11") { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); }
    if (input.key === "Escape" && win.isFullScreen()) win.setFullScreen(false);
  });
  win.loadURL("app://arcadia/index.html");
}

app.whenReady().then(() => {
  protocol.handle("app", async (req) => {
    const u = new URL(req.url);
    if (u.pathname.startsWith("/.netlify/") || u.pathname.startsWith("/api/")) {
      const init = { method: req.method, headers: { "Content-Type": req.headers.get("content-type") || "application/json" } };
      if (req.method !== "GET" && req.method !== "HEAD") init.body = await req.text();
      try { return await net.fetch(SITE + u.pathname + u.search, init); }
      catch (e) { return new Response(JSON.stringify({ error: "Нет подключения к интернету" }), { status: 503 }); }
    }
    let p = decodeURIComponent(u.pathname);
    if (p === "/" || p === "") p = "/index.html";
    const file = path.normalize(path.join(GAME, p));
    if (!file.startsWith(GAME)) return new Response("Forbidden", { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });
  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
`;

const START_BAT = `@echo off\r
chcp 65001 >nul\r
cd /d "%~dp0"\r
where npm >nul 2>nul || (echo Установите Node.js: https://nodejs.org & pause & exit /b 1)\r
if not exist node_modules (echo Первая установка, подождите... & call npm install)\r
call npm start\r
`;

const START_SH = `#!/usr/bin/env bash
cd "$(dirname "$0")"
command -v npm >/dev/null || { echo "Установите Node.js: https://nodejs.org"; exit 1; }
[ -d node_modules ] || { echo "Первая установка, подождите..."; npm install; }
npm start
`;

const README = `# АРКАДИЯ: Эон Радости — настольная версия

Игра в отдельном окне для Windows, macOS и Linux. Работает без браузера, сетевая игра подключается к ${SITE}.

## Быстрый запуск
1. Установите Node.js (LTS) с https://nodejs.org
2. Распакуйте архив.
3. Windows — дважды щёлкните \`start-windows.bat\`.
   macOS / Linux — выполните в терминале \`bash start-mac-linux.sh\`.
   Первый запуск скачивает Electron (~100 МБ), дальше игра открывается сразу.

## Собрать установщик
\`\`\`
npm install
npm run dist:win     # .exe (установщик и portable) — папка dist/
npm run dist:mac     # .dmg
npm run dist:linux   # .AppImage
\`\`\`

## Управление
- F11 — полноэкранный режим, Esc — выйти из него.
- Сохранения настольной версии отдельные. Перенос — кнопками «Скачать данные» / «Загрузить данные» в меню игры.

## Телефон
На Android и iPhone игру можно установить прямо с сайта: ${SITE}/download.html
`;

export default async () => {
  const root = findRoot();
  if (!root) return Response.json({ error: "Файлы игры недоступны" }, { status: 500 });
  const pub = join(root, "public");
  const paths: string[] = [];
  walk(pub, paths);
  const base = "arcadia-desktop/";
  const files = paths
    .filter((p) => !relative(pub, p).split(sep).includes("docs") && !p.endsWith("sw.js"))
    .map((p) => ({ name: base + "game/" + relative(pub, p).split(sep).join("/"), data: readFileSync(p) }));
  const icon = join(pub, "icons", "icon-512.png");
  if (existsSync(icon)) files.push({ name: base + "icon.png", data: readFileSync(icon) });
  files.push(
    { name: base + "package.json", data: Buffer.from(JSON.stringify(PACKAGE_JSON, null, 2) + "\n") },
    { name: base + "main.js", data: Buffer.from(MAIN_JS) },
    { name: base + "start-windows.bat", data: Buffer.from(START_BAT) },
    { name: base + "start-mac-linux.sh", data: Buffer.from(START_SH) },
    { name: base + "README.md", data: Buffer.from(README) },
  );
  return new Response(zip(files), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": 'attachment; filename="arcadia-desktop.zip"',
      "Cache-Control": "no-store",
    },
  });
};

export const config: Config = { path: "/api/desktop-app" };

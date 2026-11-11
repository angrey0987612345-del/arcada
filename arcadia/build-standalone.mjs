#!/usr/bin/env node
// Сборка АРКАДИИ в один автономный HTML-файл с рабочим сетевым (кооп) режимом.
// Все скрипты, стили и картинки встраиваются внутрь файла; сетевой клиент переписывается
// на публичный HTTPS-ретлей-сервер кооператива (https://arcadia-coop.netlify.app).
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PUB = join(HERE, "public");
const OUT = join(PUB, "arcadia-coop-standalone.html");
const RELAY = "https://arcadia-coop.netlify.app";

const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "");
const read = (f) => readFileSync(join(PUB, f), "utf8");

// Экранирование </script> внутри инлайнимого JS, чтобы не ломать HTML
const safe = (s) => s.split("</script").join("<\\/script");

const coopJs = stripComments(read("coop.js")); // путь к серверу будет заменён ниже по всему файлу
const soulJs = read("soul.js");
const exportJs = read("export.js");
const appJs = read("app.js");
const soulCss = read("soul.css");

// Картинки боссов → data-URL
let html = read("index.html");
for (const f of readdirSync(join(PUB, "assets"))) {
  if (!/\.(jpg|jpeg|png)$/i.test(f)) continue;
  const b64 = readFileSync(join(PUB, "assets", f)).toString("base64");
  const mime = /\.png$/i.test(f) ? "image/png" : "image/jpeg";
  html = html.split("/assets/" + f).join(`data:${mime};base64,${b64}`);
}

const INLINE_BLOCK = '<script src="/coop.js"></script>\n<script src="/soul.js"></script>\n<script src="/export.js"></script>\n<script src="/app.js"></script>\n<link rel="stylesheet" href="/soul.css">';
const inlineReplaced = html.includes(INLINE_BLOCK);
html = html.replace(INLINE_BLOCK,
  `<style>${soulCss}</style>\n<script>${safe(coopJs)}</script>\n<script>${safe(soulJs)}</script>\n<script>${safe(exportJs)}</script>\n<script>${safe(appJs)}</script>`);
if (!inlineReplaced) throw new Error("Не найден блок <script src=...> для инлайн-вставки — проверь index.html");

// Автономный файл: локальные ссылки на manifest/PWA-страницы не нужны
html = html
  .replace(/<link rel="manifest"[^>]*>\s*/g, "")
  .replace(/<link rel="icon"[^>]*>\s*/g, "")
  .replace(/<link rel="apple-touch-icon"[^>]*>\s*/g, "")
  .replace(/<script[^>]*src="(\/[^"]*|https?:\/\/localhost(?::\d+)?\/[^"]*)"[^>]*>\s*<\/script>/g, "");

// --- Переписываем сетевого клиента на публичный HTTPS-ретлей ---
// Все fetch('/.netlify/functions/coop...') → fetch(COOP_RELAY+'/.netlify/functions/coop...')
// (одинарные кавычки сохраняются — скобки fetch не ломаются, шаблоны не нужны)
const rewriteFetches = (src) =>
  src.replace(/fetch\('\/\.netlify\/functions\/coop/g, "fetch(COOP_RELAY+'/.netlify/functions/coop");

// Проверка: встроенные скрипты синтаксически валидны
const assertSyntax = (code, name) => { try { new Function(code); } catch (e) { throw new Error(`Синтаксическая ошибка во встроенном ${name}: ${e.message}`); } };

// 1) Встроенный coop.js — с объявлением константы COOP_RELAY в начале
const coopPatched = `const COOP_RELAY=${JSON.stringify(RELAY)}; // адрес сервера кооператива (Netlify/GitHub Pages ретлей)\n` + rewriteFetches(coopJs);
assertSyntax(coopPatched, "coop.js");
html = html.replace(`<script>${safe(coopJs)}</script>`, `<script>${safe(coopPatched)}</script>`);

// 2) Инлайновый код в index.html (список комнат и т.п.) — использует ту же глобальную COOP_RELAY
html = rewriteFetches(html);

// Проверка доступности сервера кооператива при открытии «Сетевой игры»
html = html.replace("function openMultiplayer(){showScreen('mp');checkLan();loadCoopRooms();",
  `function openMultiplayer(){showScreen('mp');checkLan();checkCoopServer();loadCoopRooms();`);
html = html.replace("function ensureInviteStarter(){",
  `async function checkCoopServer(){try{const el=$('mp-join-status');if(el)el.textContent='Проверяем сервер совместной игры…';const r=await fetch(COOP_RELAY+'/.netlify/functions/coop?action=list&capacity=2',{cache:'no-store'});if(!r.ok)throw 0;}catch(e){netSetStatus('Сервер сетевой игры сейчас недоступен — одиночный режим работает как обычно. Попробуй позже.');}}\nfunction ensureInviteStarter(){`);

if (html.includes("/.netlify/functions/coop") && !/fetch\(COOP_RELAY\+'\/\.netlify\/functions\/coop/.test(html)) throw new Error("Не переписанные обращения к ретлею остались в HTML");

writeFileSync(OUT, html);
console.log(`Готово: ${OUT} (${(html.length / 1024 / 1024).toFixed(2)} МБ)`);

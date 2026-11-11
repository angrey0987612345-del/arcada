#!/usr/bin/env node
// АРКАДИЯ — локальный сервер. Твой компьютер становится сервером игры:
// раздаёт игру и сетевую игру всем устройствам в той же Wi-Fi сети (или на точке доступа телефона).
// Без зависимостей: нужен только Node.js 18+.  Запуск:  node server.mjs [порт]
import http from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
// Папка с игрой: game/ рядом (скачанный архив) или ../public (исходники проекта)
const GAME = [join(HERE, "game"), join(HERE, "..", "public")].map((p) => resolve(p)).find((p) => existsSync(join(p, "index.html")));
if (!GAME) { console.error("Не найдена папка с игрой (game/ или ../public)."); process.exit(1); }
const START_PORT = Number(process.argv[2] || process.env.PORT) || 8080;

/* ---------- Кооп: та же логика, что у онлайн-сервера, но в памяти компьютера ---------- */
const STALE_MS = 25_000, LOBBY_ROOMS = 8, MAX_PAYLOAD = 1_000_000;
const ROOM_RE = /^[a-z0-9-]{3,64}$/i, KEY_RE = /^[a-f0-9]{32,128}$/i, LOBBY_RE = /^lobby-(\d{1,2})-(\d{1,2})$/;
const clampCapacity = (n) => Math.max(2, Math.min(30, Math.floor(Number(n)) || 2));
/** rooms: id -> { capacity, started, members: Map<slot,{key,lastSeen}>, messages: [{seq,from,id,payload,at}], ids:Set } */
const rooms = new Map();
let SEQ = 0;

function cleanupRoom(id) {
  const r = rooms.get(id); if (!r) return;
  const now = Date.now();
  for (const [slot, m] of r.members) if (now - m.lastSeen > STALE_MS) r.members.delete(slot);
  if (!r.members.has(0)) rooms.delete(id); // без хоста комната закрывается
}
const memberOf = (r, key) => { for (const [slot, m] of r?.members || []) if (m.key === key) return slot; return undefined; };

function listRooms(capacity) {
  return {
    rooms: Array.from({ length: LOBBY_ROOMS }, (_, i) => {
      const id = `lobby-${capacity}-${i + 1}`; cleanupRoom(id); const r = rooms.get(id);
      return { id, number: i + 1, capacity, count: r ? r.members.size : 0, started: r ? r.started : false };
    }),
  };
}

function enterRoom(action, id, key, requested) {
  let capacity = requested; const lobby = LOBBY_RE.exec(id);
  if (action === "enter") { if (!lobby) return [404, { error: "Комната не найдена" }]; capacity = clampCapacity(lobby[1]); }
  cleanupRoom(id);
  let r = rooms.get(id);
  if (!r) {
    if (action === "join") return [404, { error: "Комната не найдена или хост вышел" }];
    r = { capacity, started: false, members: new Map(), messages: [], ids: new Set() }; rooms.set(id, r);
  }
  let slot = memberOf(r, key);
  if (slot === undefined) {
    if (action === "create" && r.members.size) return [409, { error: "Комната с таким кодом уже занята" }];
    if (r.started && r.members.size) return [409, { error: "В этой комнате уже идёт бой" }];
    slot = -1;
    for (let s = action === "join" ? 1 : 0; s < r.capacity; s++) if (!r.members.has(s)) { slot = s; break; }
    if (slot < 0) return [409, { error: "Комната заполнена" }];
    if (slot === 0) { r.messages = []; r.ids = new Set(); r.started = false; r.capacity = lobby ? clampCapacity(lobby[1]) : capacity; }
    r.members.set(slot, { key, lastSeen: Date.now() });
  }
  const cursor = r.messages.length ? r.messages[r.messages.length - 1].seq : SEQ;
  return [200, { slot, capacity: r.capacity, cursor }];
}

function poll(id, key, after) {
  if (!ROOM_RE.test(id) || !KEY_RE.test(key)) return [400, { error: "Некорректный запрос" }];
  const r = rooms.get(id); const slot = memberOf(r, key);
  if (slot === undefined) return r ? [403, { error: "Ты больше не в этой комнате" }] : [404, { error: "Комната закрыта" }];
  r.members.get(slot).lastSeen = Date.now();
  if (Math.random() < 0.1) {
    cleanupRoom(id);
    const cut = Date.now() - 20 * 60_000; r.messages = r.messages.filter((m) => m.at >= cut);
    if (!rooms.has(id)) return [404, { error: "Комната закрыта" }];
  }
  const messages = r.messages.filter((m) => m.seq > after && m.from !== slot).slice(0, 200).map((m) => ({ seq: m.seq, payload: m.payload }));
  return [200, { messages, slots: [...r.members.keys()].sort((a, b) => a - b) }];
}

function send(id, key, msgId, payload) {
  if (typeof msgId !== "string" || msgId.length > 80) return [400, { error: "Некорректное сообщение" }];
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [400, { error: "Некорректное сообщение" }];
  const r = rooms.get(id); const slot = memberOf(r, key);
  if (slot === undefined) return [403, { error: "Ты не в этой комнате" }];
  const body = { ...payload, _from: slot };
  if (JSON.stringify(body).length > MAX_PAYLOAD) return [413, { error: "Сообщение слишком большое" }];
  if (!r.ids.has(msgId)) {
    r.ids.add(msgId); r.messages.push({ seq: ++SEQ, from: slot, id: msgId, payload: body, at: Date.now() });
    if (r.messages.length > 5000) r.messages.splice(0, r.messages.length - 5000);
  }
  if (payload.t === "start") r.started = true; else if (payload.t === "toLobby" || payload.t === "result") r.started = false;
  r.members.get(slot).lastSeen = Date.now();
  return [200, { ok: true }];
}

function leave(id, key) {
  const r = rooms.get(id); const slot = memberOf(r, key);
  if (slot !== undefined) { r.members.delete(slot); if (slot === 0) rooms.delete(id); }
  return [200, { ok: true }];
}

async function coop(req, url) {
  if (req.method === "GET") {
    if (url.searchParams.get("action") === "list") return [200, listRooms(clampCapacity(url.searchParams.get("capacity")))];
    return poll(url.searchParams.get("room") || "", url.searchParams.get("key") || "", Number(url.searchParams.get("after")) || 0);
  }
  if (req.method !== "POST") return [405, { error: "Метод не поддерживается" }];
  let body = null;
  try { body = JSON.parse(await readBody(req)); } catch {}
  if (!body || typeof body !== "object") return [400, { error: "Некорректный запрос" }];
  const { action, room, key } = body;
  if (typeof room !== "string" || !ROOM_RE.test(room)) return [400, { error: "Некорректный код комнаты" }];
  if (typeof key !== "string" || !KEY_RE.test(key)) return [400, { error: "Некорректный ключ" }];
  if (action === "create" || action === "enter" || action === "join") return enterRoom(action, room, key, clampCapacity(body.capacity));
  if (action === "send") return send(room, key, body.id, body.payload);
  if (action === "leave") return leave(room, key);
  return [400, { error: "Неизвестное действие" }];
}

function readBody(req) {
  return new Promise((ok, fail) => {
    let size = 0; const chunks = [];
    req.on("data", (c) => { size += c.length; if (size > MAX_PAYLOAD * 2) { fail(new Error("too big")); req.destroy(); } else chunks.push(c); });
    req.on("end", () => ok(Buffer.concat(chunks).toString("utf8"))); req.on("error", fail);
  });
}

/* ---------- Адреса компьютера в локальной сети ---------- */
function lanAddresses() {
  const out = [];
  for (const [name, list] of Object.entries(networkInterfaces()))
    for (const a of list || []) if (a.family === "IPv4" && !a.internal) out.push({ name, ip: a.address });
  // Обычные домашние сети и точки доступа телефона — первыми
  return out.sort((a, b) => Number(/^(192\.168|10\.|172\.)/.test(b.ip)) - Number(/^(192\.168|10\.|172\.)/.test(a.ip)));
}

/* ---------- Раздача файлов игры ---------- */
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json",
  ".webmanifest": "application/manifest+json", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml",
  ".md": "text/markdown; charset=utf-8", ".txt": "text/plain; charset=utf-8", ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document" };

let PORT = START_PORT;
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://local");
  const reply = (status, data) => { res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }); res.end(JSON.stringify(data)); };
  try {
    if (url.pathname === "/.netlify/functions/coop" || url.pathname === "/api/coop") { const [s, d] = await coop(req, url); return reply(s, d); }
    if (url.pathname === "/api/lan-info") {
      return reply(200, { local: true, port: PORT, addresses: lanAddresses().map((a) => `http://${a.ip}:${PORT}/`), rooms: rooms.size });
    }
    if (url.pathname.startsWith("/api/")) return reply(404, { error: "На локальном сервере это недоступно — скачай с онлайн-сайта игры." });
    let p = decodeURIComponent(url.pathname);
    if (p.endsWith("/")) p += "index.html";
    let file = normalize(join(GAME, p));
    if (file !== GAME && !file.startsWith(GAME + sep)) { res.writeHead(403); return res.end("Forbidden"); }
    if (!existsSync(file) && existsSync(file + ".html")) file += ".html";
    if (!existsSync(file) || !statSync(file).isFile()) {
      if (!extname(p)) file = join(GAME, "index.html"); else { res.writeHead(404); return res.end("Not found"); }
    }
    res.writeHead(200, { "Content-Type": TYPES[extname(file).toLowerCase()] || "application/octet-stream", "Cache-Control": "no-cache" });
    createReadStream(file).pipe(res);
  } catch (e) {
    console.error(e); if (!res.headersSent) reply(500, { error: "Ошибка локального сервера" }); else res.end();
  }
});

server.on("error", (e) => {
  if (e.code === "EADDRINUSE" && PORT < START_PORT + 20) { PORT++; server.listen(PORT, "0.0.0.0"); return; }
  console.error("Не удалось запустить сервер:", e.message); process.exit(1);
});
server.listen(PORT, "0.0.0.0", () => {
  const lan = lanAddresses();
  console.log("\n  ╔══════════════════════════════════════════════╗");
  console.log("  ║   АРКАДИЯ — локальный сервер запущен          ║");
  console.log("  ╚══════════════════════════════════════════════╝\n");
  console.log(`  На этом компьютере:   http://localhost:${PORT}/`);
  if (lan.length) {
    console.log("\n  Друзьям в той же Wi-Fi сети (или на твоей точке доступа) — открыть в браузере:");
    for (const a of lan) console.log(`     http://${a.ip}:${PORT}/     (${a.name})`);
  } else console.log("\n  ⚠ Компьютер не подключён к сети. Подключись к Wi-Fi или включи точку доступа на телефоне.");
  console.log("\n  Дальше: «🤝 Сетевая игра» → создать комнату → друзья входят в ту же комнату.");
  console.log("  Если Windows спросит про брандмауэр — разреши доступ для «частных сетей».");
  console.log("  Остановить сервер: закрой это окно или нажми Ctrl+C.\n");
});

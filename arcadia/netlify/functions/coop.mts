import { getDatabase } from "@netlify/database";


// Relay for the browser co-op client (public/coop.js).
// Rooms, members and messages live in Netlify Database.

const STALE_SECONDS = 25;
const LOBBY_ROOMS = 8;
const MAX_PAYLOAD = 1_000_000;
const ROOM_RE = /^[a-z0-9-]{3,64}$/i;
const KEY_RE = /^[a-f0-9]{32,128}$/i;
const LOBBY_RE = /^lobby-(\d{1,2})-(\d{1,2})$/;

const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
const fail = (error: string, status: number) => json({ error }, status);

const clampCapacity = (n: unknown) => Math.max(2, Math.min(30, Math.floor(Number(n)) || 2));

export default async (req: Request) => {
  try {
    const db = getDatabase();
    if (req.method === "GET") {
      const url = new URL(req.url);
      if (url.searchParams.get("action") === "list") return listRooms(db, clampCapacity(url.searchParams.get("capacity")));
      return poll(db, url.searchParams.get("room") || "", url.searchParams.get("key") || "", Number(url.searchParams.get("after")) || 0);
    }
    if (req.method !== "POST") return fail("Метод не поддерживается", 405);
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") return fail("Некорректный запрос", 400);
    const { action, room, key } = body as Record<string, unknown>;
    if (typeof room !== "string" || !ROOM_RE.test(room)) return fail("Некорректный код комнаты", 400);
    if (typeof key !== "string" || !KEY_RE.test(key)) return fail("Некорректный ключ", 400);
    switch (action) {
      case "create":
      case "enter":
      case "join":
        return enterRoom(db, action, room, key, clampCapacity((body as any).capacity));
      case "send":
        return send(db, room, key, (body as any).id, (body as any).payload);
      case "leave":
        return leave(db, room, key);
      default:
        return fail("Неизвестное действие", 400);
    }
  } catch (e) {
    console.error("coop error", e);
    return fail("Сервер временно недоступен", 500);
  }
};

type DB = ReturnType<typeof getDatabase>;

async function cleanupRoom(db: DB, room: string) {
  await db.sql`DELETE FROM coop_members WHERE room_id = ${room} AND last_seen < NOW() - make_interval(secs => ${STALE_SECONDS})`;
  // A room without its host (slot 0) is closed; members get 404 and disconnect.
  await db.sql`DELETE FROM coop_rooms WHERE id = ${room} AND NOT EXISTS (SELECT 1 FROM coop_members m WHERE m.room_id = ${room} AND m.slot = 0)`;
}

async function listRooms(db: DB, capacity: number) {
  const ids = Array.from({ length: LOBBY_ROOMS }, (_, i) => `lobby-${capacity}-${i + 1}`);
  for (const id of ids) await cleanupRoom(db, id);
  const rows = await db.sql`
    SELECT r.id, r.started, COUNT(m.slot)::int AS count
    FROM coop_rooms r LEFT JOIN coop_members m ON m.room_id = r.id
    WHERE r.id = ANY(${ids}) GROUP BY r.id, r.started`;
  const byId = new Map(rows.map((r: any) => [r.id, r]));
  return json({
    rooms: ids.map((id, i) => {
      const r: any = byId.get(id);
      return { id, number: i + 1, capacity, count: r ? r.count : 0, started: r ? !!r.started : false };
    }),
  });
}

async function enterRoom(db: DB, action: string, room: string, key: string, requestedCapacity: number) {
  let capacity = requestedCapacity;
  const lobby = LOBBY_RE.exec(room);
  if (action === "enter") {
    if (!lobby) return fail("Комната не найдена", 404);
    capacity = clampCapacity(lobby[1]);
  }
  await cleanupRoom(db, room);
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    let res = await client.query("SELECT id, capacity, started FROM coop_rooms WHERE id = $1 FOR UPDATE", [room]);
    let info = res.rows[0];
    if (!info) {
      if (action === "join") {
        await client.query("ROLLBACK");
        return fail("Комната не найдена или хост вышел", 404);
      }
      await client.query("INSERT INTO coop_rooms (id, capacity) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING", [room, capacity]);
      res = await client.query("SELECT id, capacity, started FROM coop_rooms WHERE id = $1 FOR UPDATE", [room]);
      info = res.rows[0];
    }
    const existing = await client.query("SELECT slot FROM coop_members WHERE room_id = $1 AND member_key = $2", [room, key]);
    let slot: number;
    if (existing.rows[0]) {
      slot = existing.rows[0].slot;
    } else {
      const taken = new Set((await client.query("SELECT slot FROM coop_members WHERE room_id = $1", [room])).rows.map((r: any) => r.slot));
      if (action === "create" && taken.size) {
        await client.query("ROLLBACK");
        return fail("Комната с таким кодом уже занята", 409);
      }
      if (info.started && taken.size) {
        await client.query("ROLLBACK");
        return fail("В этой комнате уже идёт бой", 409);
      }
      const start = action === "join" ? 1 : 0;
      slot = -1;
      for (let s = start; s < info.capacity; s++) if (!taken.has(s)) { slot = s; break; }
      if (slot < 0) {
        await client.query("ROLLBACK");
        return fail("Комната заполнена", 409);
      }
      if (slot === 0) {
        // A fresh host starts with a clean room.
        await client.query("DELETE FROM coop_messages WHERE room_id = $1", [room]);
        await client.query("UPDATE coop_rooms SET started = FALSE, capacity = $2, updated_at = NOW() WHERE id = $1", [room, lobby ? clampCapacity(lobby[1]) : capacity]);
        info.capacity = lobby ? clampCapacity(lobby[1]) : capacity;
      }
      await client.query("INSERT INTO coop_members (room_id, slot, member_key) VALUES ($1, $2, $3)", [room, slot, key]);
    }
    const cur = await client.query("SELECT COALESCE(MAX(seq), 0)::bigint AS cursor FROM coop_messages WHERE room_id = $1", [room]);
    await client.query("COMMIT");
    return json({ slot, capacity: info.capacity, cursor: Number(cur.rows[0].cursor) });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

async function member(db: DB, room: string, key: string) {
  const rows = await db.sql`SELECT slot FROM coop_members WHERE room_id = ${room} AND member_key = ${key}`;
  return rows[0] as { slot: number } | undefined;
}

async function poll(db: DB, room: string, key: string, after: number) {
  if (!ROOM_RE.test(room) || !KEY_RE.test(key)) return fail("Некорректный запрос", 400);
  const me = await member(db, room, key);
  if (!me) {
    const exists = await db.sql`SELECT 1 FROM coop_rooms WHERE id = ${room}`;
    return fail(exists.length ? "Ты больше не в этой комнате" : "Комната закрыта", exists.length ? 403 : 404);
  }
  await db.sql`UPDATE coop_members SET last_seen = NOW() WHERE room_id = ${room} AND slot = ${me.slot} AND last_seen < NOW() - INTERVAL '3 seconds'`;
  if (Math.random() < 0.1) {
    await cleanupRoom(db, room);
    await db.sql`DELETE FROM coop_messages WHERE room_id = ${room} AND created_at < NOW() - INTERVAL '20 minutes'`;
    if (!(await member(db, room, key))) return fail("Комната закрыта", 404);
  }
  const messages = await db.sql`
    SELECT seq, payload FROM coop_messages
    WHERE room_id = ${room} AND seq > ${Math.max(0, Math.floor(after))} AND from_slot <> ${me.slot}
    ORDER BY seq LIMIT 200`;
  const slots = await db.sql`SELECT slot FROM coop_members WHERE room_id = ${room} ORDER BY slot`;
  return json({
    messages: messages.map((m: any) => ({ seq: Number(m.seq), payload: m.payload })),
    slots: slots.map((s: any) => s.slot),
  });
}

async function send(db: DB, room: string, key: string, id: unknown, payload: unknown) {
  if (typeof id !== "string" || id.length > 80) return fail("Некорректное сообщение", 400);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return fail("Некорректное сообщение", 400);
  const me = await member(db, room, key);
  if (!me) return fail("Ты не в этой комнате", 403);
  const body = { ...(payload as Record<string, unknown>), _from: me.slot };
  const text = JSON.stringify(body);
  if (text.length > MAX_PAYLOAD) return fail("Сообщение слишком большое", 413);
  await db.sql`
    INSERT INTO coop_messages (room_id, from_slot, msg_id, payload)
    VALUES (${room}, ${me.slot}, ${id}, ${text}::jsonb)
    ON CONFLICT (room_id, msg_id) DO NOTHING`;
  const t = (payload as any).t;
  if (t === "start") await db.sql`UPDATE coop_rooms SET started = TRUE, updated_at = NOW() WHERE id = ${room}`;
  else if (t === "toLobby" || t === "result") await db.sql`UPDATE coop_rooms SET started = FALSE, updated_at = NOW() WHERE id = ${room}`;
  await db.sql`UPDATE coop_members SET last_seen = NOW() WHERE room_id = ${room} AND slot = ${me.slot}`;
  return json({ ok: true });
}

async function leave(db: DB, room: string, key: string) {
  const me = await member(db, room, key);
  if (me) {
    await db.sql`DELETE FROM coop_members WHERE room_id = ${room} AND slot = ${me.slot}`;
    if (me.slot === 0) await db.sql`DELETE FROM coop_rooms WHERE id = ${room}`;
  }
  return json({ ok: true });
}


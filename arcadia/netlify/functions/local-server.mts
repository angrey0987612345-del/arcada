import type { Config } from "@netlify/functions";
import { existsSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { findRoot, walk, zip } from "../lib/zip.mts";

// Packs the LAN server (player's own computer as the game server) together with the game files.

const README = `# АРКАДИЯ — локальный сервер (твой компьютер)

Компьютер становится сервером игры: раздаёт её и сетевые комнаты всем устройствам в той же Wi-Fi сети.
Интернет и онлайн-сайт не нужны.

## Запуск
1. Установи Node.js (LTS) с https://nodejs.org. Это нужно один раз, больше ничего ставить не придётся.
2. Распакуй архив.
3. Windows: дважды щёлкни \`start-server-windows.bat\`.
   macOS / Linux: \`bash start-server-mac-linux.sh\`.
4. В окне сервера появятся адреса вида \`http://192.168.1.5:8080/\`.
   Открой такой адрес на телефонах и компьютерах друзей, подключённых к той же Wi-Fi сети.
5. В игре: «🤝 Сетевая игра» → создай комнату → друзья входят по ссылке-приглашению или в ту же общую комнату.

## Без роутера
Включи на телефоне «Точку доступа» (модем), подключи к ней компьютер и телефоны друзей и открой адрес из окна сервера.

## Если не подключается
- Windows спросит про брандмауэр: разреши доступ для «частных сетей».
- Все устройства должны быть в одной сети. Гостевые сети и сети с «изоляцией клиентов» соединения между устройствами блокируют.
- Другой порт: \`node server.mjs 9000\`.

Сохранения в каждом браузере свои. Перенос: «Скачать данные» / «Загрузить данные» в меню игры.
`;

export default async () => {
  const root = findRoot();
  if (!root) return Response.json({ error: "Файлы игры недоступны" }, { status: 500 });
  const base = "arcadia-local-server/";
  const pub = join(root, "public");
  const paths: string[] = [];
  walk(pub, paths);
  const files = paths.map((p) => ({ name: base + "game/" + relative(pub, p).split(sep).join("/"), data: readFileSync(p) }));
  for (const f of ["server.mjs", "start-server-windows.bat", "start-server-mac-linux.sh"]) {
    const p = join(root, "local-server", f);
    if (existsSync(p)) files.push({ name: base + f, data: readFileSync(p) });
  }
  files.push({ name: base + "README.md", data: Buffer.from(README) });
  return new Response(zip(files), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": 'attachment; filename="arcadia-local-server.zip"',
      "Cache-Control": "no-store",
    },
  });
};

export const config: Config = { path: "/api/local-server" };

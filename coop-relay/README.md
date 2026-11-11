# АРКАДИЯ — сервер кооперативной игры (ретлей)

Небольшой Netlify-проект: HTTP-ретлей для сетевого режима игры «АРКАДИЯ».
Клиент (`public/coop.js`) обменивается с ним короткими запросами (создание/вход в комнату, отправка сообщений, опрос новых сообщений). Комнаты и сообщения хранятся в Netlify Database.

## Публичный адрес
После деплоя используйте адрес сайта, например `https://arcadia-coop.netlify.app`.
Точка входа: `/.netlify/functions/coop` (GET — список комнат и опрос, POST — create/enter/join/send/leave).

## Деплой
1. Подключите этот репозиторий к Netlify (Site settings → Build & deploy) ИЛИ перетащите папку в Netlify Drop.
2. Включите Netlify Database (Site settings → Database → Enable) — схема применится автоматически из `netlify/database/migrations/`.
3. Скопируйте домен сайта и укажите его в `RELAY` в `../arcadia/build-standalone.mjs`, затем пересоберите автономный HTML: `node build-standalone.mjs`.

CORS-заголовки выдаются через `netlify.toml`, поэтому играть можно из файла `file://`, с локального сервера и с любого хостинга.

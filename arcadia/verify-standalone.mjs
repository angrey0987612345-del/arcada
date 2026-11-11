// Проверка собранного автономного HTML: все инлайновые скрипты валидны, кооп-клиент переписан на ретлей
import { readFileSync } from "node:fs";
const html = readFileSync(new URL("public/arcadia-coop-standalone.html", import.meta.url), "utf8");
const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
let m, i = 0, bad = 0;
while ((m = re.exec(html))) {
  i++;
  try { new Function(m[1]); } catch (e) { bad++; console.log("SCRIPT #" + i + " error:", e.message.slice(0, 200)); }
}
console.log("inline scripts:", i, "errors:", bad);
console.log("has CoopConnection:", html.includes("class CoopConnection"));
console.log("has COOP_RELAY const:", /const COOP_RELAY="https:\/\//.test(html));
console.log("has checkCoopServer call:", html.includes("checkCoopServer()"));
console.log("remaining relative coop fetch:", /fetch\('\/\.netlify/.test(html));
console.log("remaining local script srcs:", /<script[^>]+src="(\/|https?:\/\/localhost)/.test(html));

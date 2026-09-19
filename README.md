# vtt.nixxon.se – statussida

En liten statussida för Nixxons Foundry VTT-instanser. Visar en kort per
instans med samma bakgrundsbild som instansens egen inloggningssida
(`/join`), samt en statuscirkel:

- 🟢 **Grön** – instansen är online och har en aktiv värld (går att logga in
  som spelare/GM).
- 🟠 **Orange** – instansen är online men ingen värld är startad
  (administrativt/setup-läge).
- 🔴 **Röd** – instansen går inte att nå. Bilden tonas ner och kortet är inte
  klickbart.

Klick på ett grönt eller orange kort går direkt till instansens `/join`-sida.

När Foundrys `/api/status` svarar visas även kampanjnamn (Foundrys
`world`-titel), spelsystem (`system`), antal anslutna spelare (`users`) och
serverns upptid (`uptime`, visas som "X dagar") under instansnamnet.

## Hur det fungerar

Det här är en enda [Cloudflare Worker](https://developers.cloudflare.com/workers/)
med statiska assets (`public/`) och ett API-anrop (`/api/status`):

- Ett **cron-triggat** jobb (`src/index.ts`, var 10:e minut, se
  `wrangler.toml`) går igenom instanserna i `src/instances.ts` och kör
  `checkInstance()`
  (`src/foundry.ts`) för var och en:
  1. Anropar `https://<host>/api/status` (Foundrys inbyggda status-endpoint)
     för att avgöra om en värld är aktiv (`active: true/false`).
  2. Anropar `https://<host>/join` för att bekräfta att inloggningssidan
     faktiskt svarar, och för att skrapa fram bakgrundsbilden som sidan
     använder.
  3. Äldre Foundry-versioner utan `/api/status` hanteras med en enklare
     fallback som tolkar HTML-svaret från `/join`.
  4. Hittas en bakgrundsbild-URL i `/join`-HTML:n, skickas den vidare till
     `syncInstanceImage()` (`src/images.ts`), som laddar ner bilden,
     SHA-256-hashar den och bara skriver till KV om den är ny/ändrad
     jämfört med vad som redan är cachat.
  5. Resultatet (status, lokal bild-URL, tidsstämpel) cachas i KV-namespace
     `STATUS_KV`.
- `/api/status` (anropas av sidan i webbläsaren) läser cachen ur KV och
  returnerar JSON. Om en instans saknar cache (t.ex. direkt efter deploy)
  körs en synkron koll för just den, så sidan aldrig visar ett tomt kort.
- `/api/image/<instans-id>` servar de faktiska bild-bytesen från KV, med
  `ETag`/`Cache-Control` för webbläsarcache.
- Statisk frontend (`public/`) hämtar `/api/status` var 30:e sekund och
  ritar upp korten, med `<img src="/api/image/<id>">`.

Anrop mot instanserna sker alltså **server-side i Workern**, inte från
besökarens webbläsare – det är nödvändigt eftersom Foundry-servrar normalt
inte tillåter CORS för sidor på andra domäner.

### Bild-detektion och -cachning

Bakgrundsbildens URL hittas genom att leta efter vanliga mönster i
`/join`-HTML:n (`background-image: url(...)`, `<img id="background">`, m.fl.,
se `IMAGE_PATTERNS` i `src/foundry.ts`). Foundrys markup kan skilja sig något
mellan versioner/teman.

Själva bildfilen laddas sedan ner och lagras i Workern (`src/images.ts`) –
sidan hotlinkar alltså **inte** direkt till instansens domän. Det betyder att
en instans som går ner fortfarande visar sin senast kända bild (nertonad, se
statuscirkel), istället för en trasig bild. Skrivningar till KV sker bara när
bildens innehåll faktiskt ändrats (jämfört via hash), inte vid varje
cron-körning, för att hålla nere antalet KV-writes.

Om ingen bild någonsin kunnat cachas för en instans visas
`public/placeholder.svg` istället (hanteras i `public/app.js` via
`<img>`:ens `onerror`).

Du kan sätta en fast käll-bild-URL manuellt per instans genom att lägga till
`imageOverride: "https://..."` i `src/instances.ts` – den laddas ner och
cachas på samma sätt som en auto-detekterad bild.

### KV-writes och Cloudflares gratisplan

`status:<id>` skrivs till KV på **varje** cron-körning, oavsett om något
ändrats. Cloudflares gratisplan för Workers KV tillåter 1 000 writes/dygn
per konto, så cron-intervallet (`wrangler.toml`) är satt till 10 minuter för
att hålla sig därunder med marginal:

```
writes/dygn = antal instanser × (1440 / cron-intervall i minuter)
            = 5 × (1440 / 10) = 720
```

Det ger ~28 % marginal upp till gränsen (utrymme för enstaka extra
skrivningar från `STALE_AFTER_MS`-fallbacken i `src/index.ts`, eller för att
lägga till någon ytterligare instans). Lägger ni till fler instanser eller
vill ha tätare uppdateringar, räkna om med formeln ovan och justera
`crons` i `wrangler.toml` (håll `STALE_AFTER_MS` något högre än
cron-intervallet, så den bara fungerar som skyddsnät om ett cron-pass
missas). Bild-writes (`image-*:<id>`) är villkorade på faktisk
innehållsändring (SHA-256-jämförelse) och påverkar knappt budgeten. Kör ni
Workers Paid-planen (`$5`/månad) är detta inget problem – där betalar man
per faktisk KV-operation utan dygnstak, och kan använda ett tätare schema.

## Lägga till/ändra instanser

Redigera `src/instances.ts`:

```ts
export const INSTANCES: InstanceConfig[] = [
  { id: "coc", name: "Call of Cthulhu", host: "coc-vtt.nixxon.se" },
  // ...
];
```

`id` används som KV-nyckel och måste vara unikt och stabilt (byt inte `id`
på en befintlig instans utan anledning – det nollställer cachen för den).

## Utveckling

```bash
npm install
npm run dev        # startar wrangler dev lokalt
npm run typecheck
```

## Deploy till Cloudflare

Deploy sker automatiskt via GitHub Actions (`.github/workflows/deploy.yml`)
vid varje push till `main`. `wrangler.toml` deklarerar
`vtt.nixxon.se` som custom domain (`routes = [{ pattern = "vtt.nixxon.se",
custom_domain = true }]`), så Cloudflare skapar och hanterar DNS-posten
automatiskt som en del av `wrangler deploy` — inga manuella API-anrop
behövs, förutsatt att zonen `nixxon.se` ligger i samma Cloudflare-konto som
deploy-tokenet.

### Engångssetup

1. **Skapa ett Cloudflare API-token** (Dashboard → My Profile → API Tokens →
   Create Custom Token) med:
   - Account → Workers Scripts → Edit
   - Account → Workers KV Storage → Edit
   - Zone → Workers Routes → Edit
   - Zone → DNS → Edit
   - Zone Resources: den specifika zonen `nixxon.se`

   Lägg till tokenet som en **repository secret** i GitHub: Settings →
   Secrets and variables → Actions → New repository secret →
   `CLOUDFLARE_API_TOKEN`. Lägg även till `CLOUDFLARE_ACCOUNT_ID` (finns i
   Cloudflare Dashboard, högerspalten på översiktssidan för kontot).

   Dela aldrig tokenet i chatt/issue/PR-text — det ska bara finnas som
   GitHub-secret.

2. **Skapa KV-namespace** (en gång, lokalt eller via `workflow_dispatch` i en
   tillfällig debug-step — måste göras innan första deploy eftersom id:t ska
   in i `wrangler.toml`):

   ```bash
   CLOUDFLARE_API_TOKEN=... npm run kv:create
   ```

   Klistra in `id` som skrivs ut i `wrangler.toml` (`[[kv_namespaces]]`),
   committa och pusha.

3. Efter det: varje push/merge till `main` deployar automatiskt, inklusive
   att `vtt.nixxon.se` pekas mot Workern.

### Manuell deploy (alternativ)

```bash
CLOUDFLARE_API_TOKEN=... npm run deploy
```

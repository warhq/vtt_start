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

## Hur det fungerar

Det här är en enda [Cloudflare Worker](https://developers.cloudflare.com/workers/)
med statiska assets (`public/`) och ett API-anrop (`/api/status`):

- Ett **cron-triggat** jobb (`src/index.ts`, var 2:a minut, se `wrangler.toml`)
  går igenom instanserna i `src/instances.ts` och kör `checkInstance()`
  (`src/foundry.ts`) för var och en:
  1. Anropar `https://<host>/api/status` (Foundrys inbyggda status-endpoint)
     för att avgöra om en värld är aktiv (`active: true/false`).
  2. Anropar `https://<host>/join` för att bekräfta att inloggningssidan
     faktiskt svarar, och för att skrapa fram bakgrundsbilden som sidan
     använder.
  3. Äldre Foundry-versioner utan `/api/status` hanteras med en enklare
     fallback som tolkar HTML-svaret från `/join`.
  4. Resultatet (status, bild-URL, tidsstämpel) cachas i en KV-namespace
     (`STATUS_KV`).
- `/api/status` (anropas av sidan i webbläsaren) läser cachen ur KV och
  returnerar JSON. Om en instans saknar cache (t.ex. direkt efter deploy)
  körs en synkron koll för just den, så sidan aldrig visar ett tomt kort.
- Statisk frontend (`public/`) hämtar `/api/status` var 30:e sekund och
  ritar upp korten.

Anrop mot instanserna sker alltså **server-side i Workern**, inte från
besökarens webbläsare – det är nödvändigt eftersom Foundry-servrar normalt
inte tillåter CORS för sidor på andra domäner.

### Bild-detektion

Bakgrundsbilden hämtas genom att leta efter vanliga mönster i `/join`-HTML:n
(`background-image: url(...)`, `<img id="background">`, m.fl., se
`IMAGE_PATTERNS` i `src/foundry.ts`). Foundrys markup kan skilja sig något
mellan versioner/teman. Om auto-detektion inte hittar något:

1. Behålls senaste kända bild (cachad i KV), annars
2. visas `public/placeholder.svg`.

Du kan även sätta en fast bild-URL manuellt per instans genom att lägga till
`imageOverride: "https://..."` i `src/instances.ts`.

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

Kräver ett Cloudflare API-token med rättigheter för Workers, KV och (för
domänbindning) zonen `nixxon.se`, satt som `CLOUDFLARE_API_TOKEN`.

1. Skapa KV-namespace (en gång):

   ```bash
   npm run kv:create
   ```

   Klistra in `id` som skrivs ut i `wrangler.toml` (`[[kv_namespaces]]`).

2. Deploya Workern:

   ```bash
   npm run deploy
   ```

3. Koppla domänen `vtt.nixxon.se` till Workern (Cloudflare Dashboard →
   Workers & Pages → vtt-status → Settings → Domains & Routes → Add →
   Custom Domain), eller via API:

   ```bash
   curl -s -X PUT \
     -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
     -H "Content-Type: application/json" \
     "https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/workers/domains" \
     -d '{"hostname":"vtt.nixxon.se","service":"vtt-status","environment":"production","zone_id":"<ZONE_ID>"}'
   ```

   Cloudflare skapar och hanterar då DNS-posten för `vtt.nixxon.se`
   automatiskt (proxied mot Workern).

# Strong Gym bestyrelse

App til bestyrelsens dagsordener, referater og opgaver. Statisk side på GitHub Pages, installeres på telefonen via "Installer app" / "Føj til hjemmeskærm".

## Sådan virker den

- `data.json` er krypteret med bestyrelsens fælles kode. Uden koden kan ingen læse indholdet, hverken i appen eller på GitHub.
- Bestyrelsen taster koden første gang, derefter husker telefonen den.
- Koden må ikke stå nogen steder i dette repo.
- Kun redaktøren kan ændre noget. Redaktøren logger ind i appen (Møder -> Redaktør) med en GitHub-nøgle, som gemmes på den telefon.
- Alt indhold ligger i `data.json`. Appen gemmer ved at skrive filen tilbage til repoet via GitHub.
- Ændringer er synlige for de andre et minuts tid efter, når GitHub Pages har udgivet filen igen.

## Opsætning

1. Settings -> Pages -> Deploy from a branch -> `main`, mappe `/ (root)`.
2. Lav en fine-grained token: Settings -> Developer settings -> Fine-grained tokens. Kun dette repo, Contents: Read and write.
3. Åbn `https://johan-bc.github.io/SG-Bestyrelse/` på telefonen, installer appen, tast koden, og log ind som redaktør med nøglen.

## Filer

- `index.html` - hele appen
- `data.json` - alle møder, krypteret. Den eneste fil der ændres i daglig brug
- `tools/data.mjs` - dekrypterer og krypterer `data.json` uden for appen
- `sw.js` - offline-cache. Hæv `CACHE`-navnet når `index.html` eller `sw.js` ændres
- `manifest.webmanifest`, `icon-*.png` - navn og ikon

## Format for data.json

Filen på GitHub er `{v, salt, iv, ct}` (AES-GCM, nøgle fra koden via PBKDF2-SHA256, 200.000 runder). Dekrypteret ser den sådan ud:

```json
{"meetings":[{
  "id": "unik-tekst",
  "date": "2026-12-10", "time": "19:00", "place": "Strong Gym",
  "agendaStatus": "klade | godkendt",
  "items": [{"id": "unik-tekst", "title": "Økonomi", "note": ""}],
  "minutes": null,
  "tasks": [{"id": "unik-tekst", "text": "", "owner": "", "due": "2026-12-31", "itemId": "", "done": false, "doneAt": ""}],
  "createdAt": "ISO-tid"
}]}
```

`minutes` er `null` eller:

```json
{"status": "klade | godkendt", "present": "navne", "absent": "navne", "eventuelt": "tekst",
 "items": {"<punktets id>": {"summary": "tekst", "decisions": "én beslutning pr. linje"}}}
```

Eventuelt står ikke i `items`. Appen viser det altid som sidste punkt.

## Regler når Claude skriver referat fra en transskription

Johan sender transskription og mødedato. Claude dekrypterer med `SG_CODE=<koden> node tools/data.mjs decrypt > /tmp/plain.json`, finder mødet, skriver `minutes` med `status: "klade"`, krypterer med `SG_CODE=<koden> node tools/data.mjs encrypt /tmp/plain.json` og committer kun `data.json`. Den dekrypterede fil må aldrig committes. Johan retter og godkender i appen.

- Følg dagsordenen punkt for punkt. Alle punkter skal med, i samme rækkefølge, under punktets eget id.
- Brug kun det, der står i transskriptionen. Opfind ingenting. Skriv det, hvis noget er uklart.
- Blev et punkt ikke behandlet: `summary` = "Punktet blev ikke behandlet på mødet."
- `summary`: 2-6 nøgterne sætninger. `decisions`: konkrete beslutninger, tom tekst hvis ingen.
- Alt uden for dagsordenen hører under `eventuelt`. Ellers "Intet at bemærke."
- `tasks`: alle opgaver og aftaler, hvor nogen skal gøre noget efter mødet. `owner` er den ansvarlige, tom hvis det ikke blev aftalt. `due` kun hvis en frist blev nævnt. Behold eksisterende opgaver, der er krydset af.
- Sæt aldrig `status` til `godkendt`. Det gør Johan.

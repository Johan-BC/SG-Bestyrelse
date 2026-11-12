# Strong Gym bestyrelse

App til bestyrelsens dagsordener, referater, forslag og opgaver. Siden ligger på GitHub Pages og installeres på telefonen via "Installer app" / "Føj til hjemmeskærm". Data og login ligger i Firebase-projektet `strong-gym-bestyrelse-1`.

## Sådan virker den

- Hvert medlem har sit eget login med mail og adgangskode. Formanden opretter medlemmet med navn, mail og rolle, og medlemmet vælger selv adgangskode første gang ("Opret login") og bekræfter sin mail.
- Kun oprettede medlemmer kan se noget.
- Formanden retter dagsorden, referat, opgaver og medlemmer og godkender forslag.
- Alle medlemmer kan foreslå punkter til dagsordenen. Et forslag kommer først på, når formanden har godkendt det.
- Opgaver tildeles et medlem. Medlemmet kan selv krydse sine egne opgaver af.
- Fanen Økonomi viser medlemstal, resultat, kasse, prognose og ønskeliste til udstyr. Alle medlemmer kan se den. Formand og kasserer kan registrere måneder og rette ønskeliste og indstillinger.
- Reglerne håndhæves af Firestore, ikke kun af appen. De ligger i Firebase-projektet og er ikke en del af dette repo.

## Filer

- `index.html` - sidens skal og udseende
- `app.js` - dagsordener, referater, forslag, opgaver og medlemmer
- `okonomi.html` - økonomi og medlemstal, en selvstændig side med samme login
- `sw.js` - cache. Hæv `CACHE`-navnet når `index.html`, `app.js`, `okonomi.html` eller `sw.js` ændres, ellers hænger den gamle udgave i telefonen
- `manifest.webmanifest`, `icon-*.png` - navn og ikon

`apiKey` i `app.js` og `okonomi.html` er Firebases offentlige web-konfiguration og ikke en hemmelighed. Adgang styres af login og Firestore-reglerne.

## Data i Firestore

- `members/{mail}`: `name`, `email`, `role` (formand, næstformand, kasserer, sekretær, bestyrelsesmedlem). Rollen formand giver redigeringsret.
- `meetings/{id}`: `date`, `time`, `place`, `agendaStatus` (klade/godkendt), `items` [{`id`, `title`, `note`, `by`}], `minutes`, `createdAt`. Eventuelt står ikke i `items` - appen viser det altid som sidste punkt.
- `minutes`: `status` (klade/godkendt), `present`, `absent`, `eventuelt`, `items` {punktets id: {`summary`, `decisions` - én pr. linje}}.
- `tasks/{id}`: `meetingId`, `itemId`, `text`, `ownerEmail`, `due`, `done`, `doneAt`, `createdAt`.
- `fin_months/{åååå-mm}`, `fin_wishlist/{id}`, `fin_config/settings`: økonomisidens måneder, ønskeliste og indstillinger.
- `proposals/{id}`: `title`, `note`, `meetingId`, `byEmail`, `status` (afventer/godkendt/afvist), `createdAt`.

## Referatklade fra en transskription

Formanden kopierer dagsordenen i appen og sender den sammen med transskriptionen til Claude. Claude svarer med ét JSON-objekt, som indsættes under Referat - "Indlæs klade":

```json
{"present": "navne", "absent": "navne",
 "items": [{"nr": 1, "summary": "tekst", "decisions": ["beslutning"]}],
 "eventuelt": "tekst",
 "tasks": [{"text": "hvad skal gøres", "owner": "medlemmets navn", "due": "2026-12-31", "nr": 3}]}
```

Regler for kladen:

- `nr` er punktets nummer på dagsordenen. Alle punkter skal med, i samme rækkefølge.
- Brug kun det, der står i transskriptionen. Opfind ingenting. Skriv det, hvis noget er uklart.
- Blev et punkt ikke behandlet: `summary` = "Punktet blev ikke behandlet på mødet."
- `summary`: 2-6 nøgterne sætninger. `decisions`: konkrete beslutninger, tom liste hvis ingen.
- Alt uden for dagsordenen hører under `eventuelt`. Ellers "Intet at bemærke."
- `tasks`: alle opgaver og aftaler, hvor nogen skal gøre noget efter mødet. `owner` er medlemmets navn, som det står i appen, tom hvis det ikke blev aftalt. `due` kun hvis en frist blev nævnt. `nr` er punktet, opgaven hører til, 0 hvis ingen.
- Kladen bliver aldrig godkendt automatisk. Det gør formanden i appen.

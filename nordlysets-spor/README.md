# Nordlysets Spor

Isometrisk overlevelses-/crafting-spil i Three.js, løst inspireret af Arnarulunnguaq og 5. Thuleekspedition.

## Hosting

Rene statiske filer, intet build-trin. Upload hele mappen (`index.html`, `style.css`, `src/`) til et vilkårligt webhotel
(GitHub Pages, Netlify, eget domæne). Three.js hentes fra jsDelivr.

Lokalt: `python3 -m http.server` i mappen og åbn http://localhost:8000 (ES-moduler kræver en server, ikke `file://`).

## Filer

- `src/main.js` – spillogik, input, HUD, vejr, døgn
- `src/world.js` – terræn, støj, modeller, udlægning af verden
- `src/dog.js` – Sikus AI
- `src/fx.js` – is/nordlys-shader, sne, partikler, fodspor, retro-efterbehandling
- `src/audio.js` – procedurel lyd (WebAudio)

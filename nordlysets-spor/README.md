# Nordlysets Spor

Isometrisk overlevelses-/crafting-spil i Three.js, løst inspireret af Arnarulunnguaq og 5. Thuleekspedition.

## Hosting

Rene statiske filer, intet build-trin. Upload hele mappen (`index.html`, `style.css`, `src/`) til et vilkårligt webhotel
(GitHub Pages, Netlify, eget domæne). Three.js hentes fra jsDelivr.

Lokalt: `python3 -m http.server` i mappen og åbn http://localhost:8000 (ES-moduler kræver en server, ikke `file://`).

## Filer

- `src/main.js` – spillogik, input, HUD, vejr, døgn
- `src/world.js` – terræn, støj, modeller, udlægning af verden
- `src/player.js` – Arnarulunnguaqs model med led og procedurel animation
- `src/dog.js` – Sikus AI og hundeanimation
- `src/scatter.js` – græstotter, småsten, snedriver og isskruninger (instansieret)
- `src/shaders.js` – sne-materiale (riller, glimt, blå skygger), nordlys-GLSL, flammer
- `src/fx.js` – is-shader, sne, tåge, partikler, fodspor, efterbehandling (glød, tilt-shift, korn)
- `src/audio.js` – procedurel lyd (WebAudio)

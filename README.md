# Portfolio Gallery

A dark, minimalist horizontal film-strip gallery for game-design projects. Drag / wheel / trackpad-swipe sideways through landscape cards; it loops endlessly. Click a card and the cover **glitches away** to reveal a video reel.

Single self-contained file — `index.html`, no dependencies, no build step.

## Projects

Edit the `PIECES` array near the top of the `<script>` in `index.html`:

```js
const PIECES = [
  { title:"Recurve", cat:"Puzzle Game Demo", role:"…", accent:"#6be3c9", video:"videos/recurve.mp4" },
  …
];
```

## Videos

Drop clips into a `videos/` folder next to `index.html`, matching the filenames in `PIECES`:

- `videos/recurve.mp4`
- `videos/assassins-weakness.mp4`
- `videos/niflheim-highway.mp4`

Landscape (16:9) plays uncropped. With no file present, a styled placeholder "reel" shows instead.

## Run locally

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

## Deploy

Static site — deploy anywhere. For Vercel:

```bash
npx vercel
```

Framework preset **Other**, no build command. Then embed the resulting URL in a Lark doc (paste → Embed).

## Controls

- **Drag / wheel / two-finger swipe** — move sideways (loops both ways)
- **Click** a centered card — reveal the video reel; **✕** or click again to close
- **Arrow keys** — previous / next · **number keys 1–4** — switch reveal effect (testing)

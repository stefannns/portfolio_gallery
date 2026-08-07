# Portfolio

Stefan's game-design portfolio. Static site — no build step at the root, no dependencies.

## The site

`index.html` is the whole page, in two sections:

1. **About** — a draggable 3D lanyard badge beside the intro copy. This is a React/three.js
   bundle; its source is `about-src/` and it is mounted into `#root`. See
   [about-src/NOTES.md](about-src/NOTES.md).
2. **Gallery** — a dark horizontal film-strip of the work. Drag / wheel / trackpad-swipe
   sideways; it loops endlessly. Click a card and the cover **glitches away** to reveal the
   video reel, with a description drawer below the frame.

`/about` also stays live as a standalone page serving the same bundle — it's embedded on its
own in a Lark doc.

## Pages

| Path | What |
|---|---|
| `/` | the combined site (about + gallery) |
| `/about` | the badge on its own |
| `/doggystack`, `/sheepjump`, `/voiceescape`, `/zoostacker` | playable Phaser builds |
| `/stattest` | mini-game test harness |

## Editing the gallery

The `PIECES` array near the top of the `<script>` in `index.html`:

```js
const PIECES = [
  { title:"Assassin's Weakness is Love", cn:"心动刺客", cat:"Rhythm Game", date:"May 2025",
    accent:"#b98cff", cover:"assassin/awil_cover.png", video:REELS+"/assassin-l1.mp4",
    desc:"…", levels:[ … ] },
  …
];
```

Per piece: `cn` adds the Chinese name beside the title, `accent` drives that card's glow and
highlights, `desc`/`desc2` fill the drawer, `levels` adds tabs (Assassin has two), and `hover`
is a clip that plays on hover (Niflheim).

## Videos

Reels are **not** in the repo — they're too large. They live in a public Supabase Storage
bucket, referenced through the `REELS` base constant in `index.html`. Covers are committed.

Compression used for the hosted reels (keeps them under Supabase's 50 MB/file cap, with audio):

```bash
ffmpeg -i in.mov -vf scale=-2:720 -c:v libx264 -crf 23 -maxrate 2.3M -bufsize 4.6M -c:a aac -b:a 128k -movflags +faststart out.mp4
```

## Run locally

Serve from the repo root — the about bundle is referenced by absolute path (`/about/assets/…`),
so opening `index.html` as a `file://` URL will not load it.

```bash
python3 -m http.server 8000
```

## Deploy

Static, no build command, framework preset **Other**. Vercel auto-deploys on push to `main`.
After changing anything in `about-src/`, rebuild and commit the output:

```bash
cd about-src && npm run build
```

## Controls

- **Drag / wheel / two-finger swipe** — move sideways (loops both ways)
- **Click** a centered card — reveal the reel; **✕** to close
- **Arrow keys** — previous / next

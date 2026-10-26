# Kitchen source

React, Three.js and Vite source for the portfolio at the repository root. Runtime models, artwork, fonts and audio are stored once in the root asset directories.

Run `npm ci`, then `npm run dev`. The predev helper creates ignored local asset links for development; it does not copy credentials or change the published assets.

Run `npm run check` to check walking routes. Run `npm run build -- --configLoader native` to replace the root `index.html` and compiled JS/CSS. The build leaves legacy project directories and Vercel rewrites in place. Commit those output changes together with source changes, then push to `main` to publish through the existing Vercel integration.

The current Otome Story Engine cover is `/images/covers/otome-story-engine-v4.png`. Earlier cover artwork is retained in `artwork/covers/`.

The published starting arrangement is stored in `src/room-v10-layout.json`. Editing in `?arrange=1` saves to that browser only; copy the completed positions into this file and rebuild to share them with every visitor.

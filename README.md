# Stefan’s Kitchen — Portfolio

The homepage is now a playable capybara kitchen portfolio. Explore the room, inspect projects, and push the toy title letters. Published at https://stefansun.vercel.app/ through the existing Vercel integration.

## Explore

- WASD or click the floor to walk. On phones, turn sideways and use the joystick or tap the floor.
- Click or tap project objects to open them; E inspects a nearby highlighted object.
- Sticky notes guide the vegetables bag → recorder → computer tour. All project objects stay available.
- Desktop plays quiet background music after the browser allows audio. Mobile keeps footsteps and interaction sounds; the music player is hidden on all screens.
- Try the sink bubbles, launch the frying pan, startle the fish beside the knives, or throw the four tomatoes at the camera. Tomatoes do not refill during a visit. E uses the closest object in reach.
- The game scene keeps a 16:9 landscape frame. Portrait phones show a rotation prompt.

Seed Squad has an embedded game preview and a design content library. Smarttester links to its workflow tour. Otome Story Engine (Minimax H3) includes a demo video and an English AI workflow diagram. Existing game covers and reels are retained.

## Edit and publish

The shared starting arrangement lives in `kitchen-src/src/room-v10-layout.json`. The editable website lives in `kitchen-src/`; see its README for local development, navigation checks and rebuilding. The generated homepage and its runtime assets are served directly from the repository root, retaining the existing static-hosting configuration.

Push `main` to publish through Vercel. The old project and temporary work URLs, `about/`, `gallery/`, and `vercel.json` rewrites remain available. The previous gallery documentation is preserved in `docs/portfolio-gallery-legacy.md`, and previous homepage versions remain in Git history.

# Batch 1 template exports

`playablebatch1/templates/en/<game>/` and `it/<game>/` are the standalone products.
Each contains only `App.jsx`, `check.js`, `asset_manifest.json`, and `dist/` with
`game.html`, `bundle.js`, `game.config.json`, and `assets/`.

The current, served game files remain in `playablebatch1/games/`. After editing
those files, run from the repository root:

```sh
node scripts/standardize-playable-templates.mjs
node scripts/build-game-downloads.mjs
node scripts/build-game-downloads.mjs --check
node --test scripts/game-download-ui.test.mjs
python3 scripts/verify-game-downloads.py
```

The commands need Node.js and Python 3. The checked-in generator includes its
parser; running it requires no npm installation. The optional package in this
directory is only for rebuilding that generator after changing
`standardize-source.mjs`: install its pinned development dependencies here and
run `npm run build`.

The exporter merges the latest classic browser scripts and styles. It preserves
config IDs, asset bytes, execution order and script metadata. It rejects module
entries requiring a separate bundling step. `App.jsx` is consolidated current
runtime code, including existing compiled code, rather than recovered historical
React authoring source. Within an exported product, `node check.js --build`
rebuilds the runtime without dependencies.

The registry outside the template folders records input hashes. Download builds
reject stale exports when a served entry, script, config or asset changes.
English ZIPs retain their existing URLs; Italian ZIPs use `-it.zip`. The page's
language selector chooses the archive. Other games keep their previous exports.

No process files, documentation, parser libraries or tests enter a template or
its ZIP. Explicit directory entries preserve an empty `dist/assets/` directory.

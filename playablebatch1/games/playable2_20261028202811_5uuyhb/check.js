/* Verify the current source, runtime, registered assets and exact handoff tree. */
(async () => {
  const fs = await import('node:fs'), path = await import('node:path'), crypto = await import('node:crypto'), vm = await import('node:vm');
  const root = path.dirname(path.resolve(process.argv[1]));
  const assert = (test, message) => { if (!test) throw Error(message); };
  const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
  const exact = (folder, names) => assert(JSON.stringify(fs.readdirSync(folder).sort()) === JSON.stringify(names.sort()), 'Unexpected file structure: ' + folder);
  exact(root, ['App.jsx','check.js','asset_manifest.json','dist']);
  exact(root + '/dist', ['game.html','bundle.js','game.config.json','assets']);
  const manifest = JSON.parse(fs.readFileSync(root + '/asset_manifest.json'));
  for (const [file, digest] of Object.entries(manifest.files)) assert(hash(fs.readFileSync(root + '/' + file)) === digest, 'Source/build hash mismatch: ' + file);
  const walk = (dir, prefix = '') => fs.readdirSync(dir,{withFileTypes:true}).flatMap(entry => {
    assert(!entry.isSymbolicLink() && !entry.name.startsWith('.') && !/^(node_modules|__MACOSX|backups?|tests?)$/i.test(entry.name), 'Forbidden file: ' + entry.name);
    return entry.isDirectory() ? walk(path.join(dir,entry.name),prefix + entry.name + '/') : [prefix + entry.name];
  });
  const paths = walk(root + '/dist/assets').map(file => 'dist/assets/' + file).sort();
  assert(JSON.stringify(paths) === JSON.stringify(manifest.assets.map(asset=>asset.path).sort()), 'Asset manifest does not match files');
  for (const asset of manifest.assets) {
    assert(asset.path.startsWith('dist/assets/') && !asset.path.split('/').includes('..'), 'Invalid asset path');
    const bytes = fs.readFileSync(root + '/' + asset.path);
    assert(bytes.length === asset.bytes && hash(bytes) === asset.sha256, 'Stale asset: ' + asset.path);
  }
  const cfg = JSON.parse(fs.readFileSync(root + '/dist/game.config.json'));
  for (const key of ['texts','tweaks','images']) assert(Array.isArray(cfg[key]), 'Missing config array: ' + key);
  for (const image of cfg.images) assert(fs.existsSync(path.resolve(root + '/dist',image.path)), 'Missing Config image: ' + image.path);
  const html = fs.readFileSync(root + '/dist/game.html','utf8');
  assert(!/bundle\.css|https?:\/\//.test(html), 'External or missing HTML dependency');
  assert([...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map(m=>m[1]).join() === './bundle.js', 'HTML must load only its local bundle');
  new vm.Script(fs.readFileSync(root + '/dist/bundle.js','utf8'),{filename:'bundle.js'});
  console.log(JSON.stringify({valid:true,task:manifest.task_id,assets:paths.length,sourceKind:manifest.source_kind}));
})().catch(error=>{ console.error(JSON.stringify({valid:false,error:error.message}));process.exitCode=1; });

import {access, lstat, mkdir, symlink} from 'node:fs/promises';
import {dirname, join, relative} from 'node:path';
import {fileURLToPath} from 'node:url';

const source = fileURLToPath(new URL('../', import.meta.url));
const publicDirectory = join(source, 'public');
const repository = dirname(source.replace(/\/$/, ''));
await mkdir(publicDirectory, {recursive: true});
for (const name of ['audio', 'character', 'draco', 'fonts', 'gallery', 'images', 'models', 'sushi', 'videos', 'workflows']) {
  const target = join(repository, name), link = join(publicDirectory, name);
  await access(target);
  try {await lstat(link);}
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await symlink(relative(publicDirectory, target), link, 'dir');
  }
}
console.log('Local development assets are ready.');

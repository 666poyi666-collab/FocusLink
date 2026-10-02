import fs from 'node:fs';
import { nextReleaseVersion } from '../../shared/releaseVersionPolicy.ts';
const current = JSON.parse(
  fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
).version;
process.stdout.write(`${nextReleaseVersion(current)}\n`);

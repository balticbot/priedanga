import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildVectors } from './vectors.js';

const out = fileURLToPath(new URL('../test-vectors/v1.json', import.meta.url));
const file = buildVectors();
writeFileSync(out, JSON.stringify(file, null, 2) + '\n');
console.log(`wrote ${file.alertVectors.length} alert vectors and ${file.certificateVectors.length} certificate vectors to ${out}`);

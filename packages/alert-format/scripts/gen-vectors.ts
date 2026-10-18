import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildEd25519Vectors } from './ed25519-vectors.js';
import { buildVectors } from './vectors.js';

const out = fileURLToPath(new URL('../test-vectors/v1.json', import.meta.url));
const file = buildVectors();
writeFileSync(out, JSON.stringify(file, null, 2) + '\n');
console.log(`wrote ${file.alertVectors.length} alert vectors and ${file.certificateVectors.length} certificate vectors to ${out}`);

const edOut = fileURLToPath(new URL('../test-vectors/ed25519-strict.json', import.meta.url));
const ed = buildEd25519Vectors();
writeFileSync(edOut, JSON.stringify(ed, null, 2) + '\n');
console.log(`wrote ${ed.vectors.length} Ed25519 strictness vectors to ${edOut}`);

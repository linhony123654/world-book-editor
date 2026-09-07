import fs from 'node:fs';

const path = 'public/modules/ai/tools/worldbook-read.js';
let src = fs.readFileSync(path, 'utf8');
const lines = [
  '  const emittedShared = new Set();\n',
  "        const pairKey = [entry.uid, h].sort((a, b) => a - b).join(':') + ':' + k.toLowerCase();\n",
  '        if (emittedShared.has(pairKey)) continue;\n',
  '        emittedShared.add(pairKey);\n'
];
for (const line of lines) src = src.replace(line, '');
if (src.includes('emittedShared') || src.includes('pairKey = [entry.uid')) {
  throw new Error('shared-key dedupe behavior still present');
}
fs.writeFileSync(path, src);
console.log('restored legacy duplicate shared-key reporting semantics');

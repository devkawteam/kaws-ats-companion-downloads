const fs = require('node:fs');
const path = require('node:path');
const { getBuffer } = require('trucksim-telemetry');

const SHARED_MEMORY = 'Local\\SCSTelemetry';

console.log('ATS Playground Companion Doctor v0.4.6');
console.log('=======================================');
console.log(`Node: ${process.version}`);
console.log(`Platform: ${process.platform} ${process.arch}`);
console.log(`config.json: ${fs.existsSync(path.join(process.cwd(),'config.json')) ? 'FOUND' : 'MISSING'}`);

try {
  const p = require('trucksim-telemetry/package.json');
  console.log(`trucksim-telemetry: INSTALLED (${p.version})`);
  console.log(`package node requirement: ${p.engines?.node || 'unknown'}`);
} catch {
  console.log('trucksim-telemetry: NOT INSTALLED');
}

try {
  const b = getBuffer({ sharedMemoryName: SHARED_MEMORY });
  if (!b) {
    console.log(`shared memory ${SHARED_MEMORY}: NOT OPEN`);
  } else {
    let nonZero = 0;
    for (const byte of b) if (byte !== 0) nonZero++;
    console.log(`shared memory ${SHARED_MEMORY}: OPEN (${b.length} bytes, ${nonZero} non-zero bytes)`);
  }
} catch (e) {
  console.log(`shared memory ${SHARED_MEMORY}: ERROR (${e.message})`);
}

const { getBuffer, getData, truckSimTelemetry } = require('trucksim-telemetry');

const SHARED_MEMORY = 'Local\\SCSTelemetry';

console.log('====================================================');
console.log(' ATS Playground Telemetry Probe v1.6.0');
console.log(` Shared memory: ${SHARED_MEMORY}`);
console.log(' ATS must be open and fully loaded into the truck.');
console.log(' Press Ctrl+C to stop.');
console.log('====================================================');

function inspectRawBuffer() {
  const buffer = getBuffer({ sharedMemoryName: SHARED_MEMORY });

  if (!buffer) {
    return {
      open: false,
      message: 'Memory map could not be opened.'
    };
  }

  let nonZeroBytes = 0;
  let firstNonZero = -1;
  for (let i = 0; i < buffer.length; i++) {
    if (buffer[i] !== 0) {
      nonZeroBytes++;
      if (firstNonZero === -1) firstNonZero = i;
    }
  }

  return {
    open: true,
    length: buffer.length,
    nonZeroBytes,
    firstNonZero,
    first64Hex: buffer.subarray(0, 64).toString('hex')
  };
}

console.log('[RAW]', inspectRawBuffer());

const direct = getData({ sharedMemoryName: SHARED_MEMORY });
console.log('[PARSED-ONCE]', direct ? {
  sdkActive: direct.sdkActive,
  game: direct.game,
  telemetryPluginRevision: direct.telemetryPluginRevision,
  versionMajor: direct.versionMajor,
  versionMinor: direct.versionMinor,
  truckBrand: direct.truckBrand,
  truckName: direct.truckName,
  speed: direct.speed,
  fuel: direct.fuel
} : 'NO DATA');

let count = 0;
const telemetry = truckSimTelemetry({
  sharedMemoryName: SHARED_MEMORY,
  onUpdate(data) {
    count++;
    if (count % 120 !== 0) return;

    const raw = inspectRawBuffer();
    console.log('');
    console.log(`[PROBE] update ${count}`);
    console.log('[RAW-STATUS]', raw);

    console.log('[DATA]', {
      sdkActive: data.sdkActive,
      paused: data.paused,
      game: data.game,
      telemetryPluginRevision: data.telemetryPluginRevision,
      versionMajor: data.versionMajor,
      versionMinor: data.versionMinor,
      telemetryVersionGameMajor: data.telemetryVersionGameMajor,
      telemetryVersionGameMinor: data.telemetryVersionGameMinor,
      truckBrand: data.truckBrand,
      truckName: data.truckName,
      speed: data.speed,
      engineRpm: data.engineRpm,
      fuel: data.fuel,
      truckOdometer: data.truckOdometer,
      cargo: data.cargo,
      citySrc: data.citySrc,
      cityDst: data.cityDst
    });

    if (!raw.open) {
      console.log('[DIAGNOSIS] The Windows shared-memory object does not exist.');
    } else if (raw.nonZeroBytes === 0) {
      console.log('[DIAGNOSIS] The memory map exists but is completely zeroed. The game-side SDK plugin is not populating it.');
    } else if (!data.sdkActive) {
      console.log('[DIAGNOSIS] The map contains bytes, but sdkActive is false. Likely plugin initialization/layout mismatch.');
    } else {
      console.log('[DIAGNOSIS] Live telemetry is active.');
    }
  }
});

telemetry.on('connected', () => console.log('[EVENT] connected'));
telemetry.on('disconnected', () => console.log('[EVENT] disconnected'));

// KAW Livery Wizard export worker: DDS encoding and ZIP packing off the page thread. Author: Kaw.
importScripts('/livery/livery-core.js');
self.onmessage = e => {
  const m = e.data;
  try {
    if (m.op === 'dds') {
      const out = self.KAWLivery.encodeDds(new Uint8Array(m.rgba), m.w, m.h, { mips: m.mips !== false, onProgress: p => self.postMessage({ id: m.id, progress: p }) });
      self.postMessage({ id: m.id, ok: true, data: out }, [out.buffer]);
    } else if (m.op === 'mod') {
      const files = self.KAWLivery.buildMod(m.spec);
      const out = self.KAWLivery.zip(files);
      self.postMessage({ id: m.id, ok: true, data: out, files: files.map(f => f.name) }, [out.buffer]);
    } else throw new Error(`Unknown job ${m.op}`);
  } catch (err) {
    self.postMessage({ id: m.id, ok: false, error: err.message });
  }
};

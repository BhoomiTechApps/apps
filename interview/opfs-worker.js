// Writes recording chunks into the Origin Private File System using sync access
// handles. Data lands on disk as it arrives, so it survives a tab crash.
const files = new Map(); // name -> { handle, pos, sinceFlush }
let queue = Promise.resolve();

self.onmessage = (e) => {
  queue = queue.then(() => handle(e.data)).catch((err) => {
    self.postMessage({ id: e.data.id, ok: false, error: String(err && err.message || err) });
  });
};

async function dir() {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle('sessions', { create: true });
}

function wavHeader(dataBytes, channels, sampleRate, bits) {
  const h = new DataView(new ArrayBuffer(44));
  const str = (o, s) => { for (let i = 0; i < 4; i++) h.setUint8(o + i, s.charCodeAt(i)); };
  const blockAlign = channels * bits / 8;
  str(0, 'RIFF'); h.setUint32(4, 36 + dataBytes, true); str(8, 'WAVE');
  str(12, 'fmt '); h.setUint32(16, 16, true); h.setUint16(20, 1, true);
  h.setUint16(22, channels, true); h.setUint32(24, sampleRate, true);
  h.setUint32(28, sampleRate * blockAlign, true); h.setUint16(32, blockAlign, true);
  h.setUint16(34, bits, true);
  str(36, 'data'); h.setUint32(40, dataBytes, true);
  return new Uint8Array(h.buffer);
}

async function handle(m) {
  let result;
  if (m.cmd === 'open') {
    const fh = await (await dir()).getFileHandle(m.name, { create: true });
    const handle = await fh.createSyncAccessHandle();
    handle.truncate(0);
    files.set(m.name, { handle, pos: 0, sinceFlush: 0 });
  } else if (m.cmd === 'write') {
    const f = files.get(m.name);
    if (!f) throw new Error('File not open: ' + m.name);
    const data = new Uint8Array(m.buffer);
    if (m.at !== undefined) {
      f.handle.write(data, { at: m.at });
    } else {
      f.pos += f.handle.write(data, { at: f.pos });
    }
    f.sinceFlush += data.byteLength;
    if (f.sinceFlush > 4 * 1024 * 1024) { f.handle.flush(); f.sinceFlush = 0; }
  } else if (m.cmd === 'close') {
    const f = files.get(m.name);
    if (f) { f.handle.flush(); f.handle.close(); files.delete(m.name); }
  } else if (m.cmd === 'finalizeWav') {
    // Rewrites the WAV header from the real file size. Used at stop and for crash recovery.
    let f = files.get(m.name), opened = false;
    if (!f) {
      const fh = await (await dir()).getFileHandle(m.name);
      f = { handle: await fh.createSyncAccessHandle() }; opened = true;
    }
    const size = f.handle.getSize();
    const blockAlign = m.channels * 3;
    const dataBytes = Math.max(0, Math.floor((size - 44) / blockAlign) * blockAlign);
    f.handle.write(wavHeader(dataBytes, m.channels, m.sampleRate, 24), { at: 0 });
    f.handle.flush();
    if (opened) f.handle.close();
    result = { dataBytes };
  } else if (m.cmd === 'probe') {
    // Sync access handles only exist inside workers, so support is checked here.
    result = { supported: typeof FileSystemFileHandle !== 'undefined' &&
      'createSyncAccessHandle' in FileSystemFileHandle.prototype && !!(navigator.storage && navigator.storage.getDirectory) };
  } else if (m.cmd === 'closeAll') {
    for (const [, f] of files) { try { f.handle.flush(); f.handle.close(); } catch {} }
    files.clear();
  }
  self.postMessage({ id: m.id, ok: true, result });
}

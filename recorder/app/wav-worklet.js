// Runs on the audio rendering thread. Converts float samples to 24-bit little-endian
// interleaved PCM and posts ~100 ms batches to the page.
//
// It always keeps the last ~2 s of audio in a ring buffer, so a recording can begin at an
// exact sample, even one slightly in the past. That lets the WAV start at the same instant
// as the video, instead of whenever this thread happened to get the message.
const RING_SECONDS = 2;
const BLOCK = 128;

class WavCapture extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.ch = options.processorOptions.channels;
    this.batchFrames = options.processorOptions.batchFrames || 4800;
    this.bytesPerFrame = this.ch * 3;
    this.alloc();

    this.ringBlocks = Math.ceil((RING_SECONDS * sampleRate) / BLOCK);
    this.ring = Array.from({ length: this.ringBlocks }, () => new Float32Array(BLOCK * this.ch));
    this.ringFrame = new Float64Array(this.ringBlocks).fill(-1); // start frame of each stored block
    this.ringPos = 0;

    this.startFrame = null;   // armed: first frame to record
    this.recording = false;
    this.stopRequested = false;

    this.port.onmessage = (e) => {
      const d = e.data;
      if (d === 'start') this.startFrame = currentFrame;              // right now
      else if (d && d.startAt != null) this.startFrame = Math.max(0, Math.round(d.startAt));
      else if (d === 'stop') this.stopRequested = true;
    };
  }

  alloc() {
    this.buf = new Uint8Array(this.batchFrames * this.bytesPerFrame);
    this.frames = 0;
  }

  flush(final) {
    if (this.frames > 0) {
      const out = this.frames === this.batchFrames ? this.buf : this.buf.slice(0, this.frames * this.bytesPerFrame);
      this.port.postMessage({ type: 'data', buffer: out.buffer }, [out.buffer]);
      this.alloc();
    }
    if (final) this.port.postMessage({ type: 'stopped' });
  }

  // Appends frames [from, to) of an interleaved block (null = silence).
  write(block, from, to) {
    for (let i = from; i < to; i++) {
      let o = this.frames * this.bytesPerFrame;
      const b = this.buf;
      for (let c = 0; c < this.ch; c++) {
        let s = block ? block[i * this.ch + c] : 0;
        if (s > 1) s = 1; else if (s < -1) s = -1;
        const v = Math.round(s < 0 ? s * 8388608 : s * 8388607);
        b[o++] = v & 255; b[o++] = (v >> 8) & 255; b[o++] = (v >> 16) & 255;
      }
      this.frames++;
      if (this.frames === this.batchFrames) this.flush(false);
    }
  }

  writeSilence(n) {
    while (n > 0) { const k = Math.min(n, BLOCK); this.write(null, 0, k); n -= k; }
  }

  process(inputs) {
    // 1. Store this block (interleaved) in the ring.
    const input = inputs[0];
    const len = input && input[0] ? input[0].length : BLOCK;
    const slot = this.ring[this.ringPos];
    for (let i = 0; i < len; i++) {
      for (let c = 0; c < this.ch; c++) {
        const chan = input && (input[c] || input[0]);
        slot[i * this.ch + c] = chan ? chan[i] : 0; // silence if the input drops, to keep timing
      }
    }
    this.ringFrame[this.ringPos] = currentFrame;
    const thisPos = this.ringPos;
    this.ringPos = (this.ringPos + 1) % this.ringBlocks;

    // 2. Armed and the start sample has arrived (or already passed): begin, replaying from the ring.
    if (!this.recording && this.startFrame != null && this.startFrame < currentFrame + len) {
      const F = this.startFrame;
      this.startFrame = null;
      this.recording = true;
      this.port.postMessage({ type: 'started', frame: F, contextTime: F / sampleRate });

      // Oldest block still in the ring
      let oldestPos = this.ringPos, guard = 0;
      while (this.ringFrame[oldestPos] < 0 && guard++ < this.ringBlocks) oldestPos = (oldestPos + 1) % this.ringBlocks;
      const oldestFrame = this.ringFrame[oldestPos];
      if (F < oldestFrame) this.writeSilence(oldestFrame - F); // earlier than we kept: pad to stay aligned

      for (let p = oldestPos, n = 0; n < this.ringBlocks; p = (p + 1) % this.ringBlocks, n++) {
        const bf = this.ringFrame[p];
        if (bf >= 0 && bf + BLOCK > F) this.write(this.ring[p], Math.max(0, F - bf), p === thisPos ? len : BLOCK);
        if (p === thisPos) break;
      }
    } else if (this.recording) {
      this.write(slot, 0, len);
    }

    if (this.recording && this.stopRequested) {
      this.recording = false;
      this.stopRequested = false;
      this.flush(true);
    } else if (!this.recording && this.stopRequested) {
      this.stopRequested = false;
      this.startFrame = null;
      this.flush(true);
    }
    return true;
  }
}
registerProcessor('wav-capture', WavCapture);

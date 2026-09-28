// Runs on the audio rendering thread. Converts incoming float samples to
// 24-bit little-endian interleaved PCM and posts ~100 ms batches to the page.
class WavCapture extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.ch = options.processorOptions.channels;
    this.batchFrames = options.processorOptions.batchFrames || 4800;
    this.bytesPerFrame = this.ch * 3;
    this.alloc();
    this.recording = false;
    this.stopRequested = false;
    this.port.onmessage = (e) => {
      if (e.data === 'start') {
        this.recording = true;
        this.port.postMessage({ type: 'started', contextTime: currentTime });
      } else if (e.data === 'stop') {
        this.stopRequested = true;
      }
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
  process(inputs) {
    if (this.recording) {
      const input = inputs[0];
      const len = input && input[0] ? input[0].length : 128; // write silence if input drops, to keep timing
      let b = this.buf;
      for (let i = 0; i < len; i++) {
        let o = this.frames * this.bytesPerFrame;
        for (let c = 0; c < this.ch; c++) {
          const chan = input && (input[c] || input[0]);
          let s = chan ? chan[i] : 0;
          if (s > 1) s = 1; else if (s < -1) s = -1;
          const v = Math.round(s < 0 ? s * 8388608 : s * 8388607);
          b[o++] = v & 255; b[o++] = (v >> 8) & 255; b[o++] = (v >> 16) & 255;
        }
        this.frames++;
        if (this.frames === this.batchFrames) { this.flush(false); b = this.buf; }
      }
      if (this.stopRequested) {
        this.recording = false;
        this.stopRequested = false;
        this.flush(true);
      }
    }
    return true;
  }
}
registerProcessor('wav-capture', WavCapture);

// Runs in AudioWorkletGlobalScope. Only PCM audio leaves this processor; no device or credential access.
class CompanionPCM extends AudioWorkletProcessor {
  constructor() { super(); this.samples = []; this.enabled = true; this.port.onmessage = event => { if (event.data === 'stop') { this.enabled = false; this.flush(); this.port.postMessage('stopped') } } }
  flush() {
    if (!this.samples.length) return
    const bytes = new ArrayBuffer(this.samples.length * 2); const view = new DataView(bytes)
    this.samples.forEach((value, i) => view.setInt16(i * 2, Math.round(Math.max(-1, Math.min(1, value)) * (value < 0 ? 32768 : 32767)), true))
    this.samples = []; this.port.postMessage(bytes, [bytes])
  }
  process(inputs) {
    if (!this.enabled) return false
    const channels = inputs[0]
    if (channels?.length) for (let i = 0; i < channels[0].length; i++) {
      this.samples.push(channels.reduce((sum, channel) => sum + (channel[i] || 0), 0) / channels.length)
      if (this.samples.length === 4800) this.flush()
    }
    return true
  }
}
registerProcessor('companion-pcm', CompanionPCM)

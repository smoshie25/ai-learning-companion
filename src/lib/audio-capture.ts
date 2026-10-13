import type { RecordingSnapshot } from '../../shared/session-contracts.cts'
export type AudioCapture = { stop(): Promise<void> }
/** Permission is gated in main by the active session and its recorded consent. No audio is kept on disk. */
export async function captureSessionAudio(session: Pick<RecordingSnapshot, 'source' | 'id'>, onFailure: () => void, transport: { connect(input: {id:string}): Promise<import('../../shared/contracts.cts').Result<unknown>>; audio(input: {id:string;sequence:number;pcm:string}): Promise<import('../../shared/contracts.cts').Result<null>> } = window.companion!.intelligence): Promise<AudioCapture> {
  const streams: MediaStream[] = []; let context: AudioContext | undefined; let worklet: AudioWorkletNode | undefined
  let stopped = false; let sequence = 0; let failed = false; let stopping: Promise<void> | undefined; let acknowledge: (() => void) | undefined
  const pending = new Set<Promise<void>>()
  const stop = () => stopping ??= (async () => {
    streams.forEach(stream => stream.getTracks().forEach(track => track.stop()))
    if (worklet && !failed) await new Promise<void>(resolve => { const timer = setTimeout(resolve, 300); acknowledge = () => { clearTimeout(timer); resolve() }; worklet!.port.postMessage('stop') })
    stopped = true
    if (worklet) { worklet.port.onmessage = null; worklet.disconnect() }
    await context?.close().catch(() => {})
    await Promise.allSettled([...pending])
  })()
  const failure = () => { if (stopped || failed || stopping) return; failed = true; void stop().then(onFailure) }
  try {
    streams.push(await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: session.source !== 'microphone_system', noiseSuppression: true }, video: false }))
    if (session.source === 'microphone_system') {
      const system = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true })
      streams.push(system)
      if (!system.getAudioTracks().length) throw new Error('System audio is unavailable. Choose microphone only and try again.')
      system.getVideoTracks().forEach(track => { track.enabled = false })
    }
    streams.forEach(stream => stream.getTracks().forEach(track => track.addEventListener('ended', failure, { once: true })))
    const connected = await transport.connect({ id: session.id })
    if (!connected.ok) throw new Error(connected.error.message)
    context = new AudioContext({ sampleRate: 24000 })
    if (context.sampleRate !== 24000) throw new Error('This audio device cannot produce the required 24 kHz recording format.')
    await context.audioWorklet.addModule(new URL('audio-capture.js', document.baseURI).href)
    worklet = new AudioWorkletNode(context, 'companion-pcm', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1 })
    // Mix consented sources into mono. The processor emits silence to the output: no local echo.
    const mix = context.createGain(); mix.gain.value = streams.length > 1 ? 0.5 : 1
    streams.forEach(stream => context!.createMediaStreamSource(stream).connect(mix))
    mix.connect(worklet); worklet.connect(context.destination)
    worklet.port.onmessage = event => {
      if (event.data === 'stopped') { acknowledge?.(); return }
      if (stopped || failed) return
      if (pending.size >= 3) { failure(); return }
      const bytes = new Uint8Array(event.data as ArrayBuffer)
      const pcm = btoa(String.fromCharCode(...bytes))
      const request = transport.audio({ id: session.id, sequence: sequence++, pcm }).then(result => { if (!result.ok) failure() }).catch(failure)
      pending.add(request); void request.finally(() => pending.delete(request))
    }
    await context.resume()
    return { stop }
   } catch (error) {
    await stop()
    const name=error instanceof Error?error.name:''
    if(['NotAllowedError','PermissionDeniedError','SecurityError'].includes(name))throw new Error('Microphone access was denied. Allow microphone access in your system privacy settings (on Windows, enable Microphone access and Let desktop apps access your microphone), then resume and approve the microphone prompt. System audio also requires its separate capture confirmation.')
    if(name==='NotFoundError')throw new Error('No microphone was found. Connect or enable a microphone, then resume listening.')
    if(name==='NotReadableError')throw new Error('The microphone could not be opened. Check whether another app is using it and whether the device is enabled, then resume listening.')
    throw error instanceof Error ? error : new Error('Microphone access was declined or is unavailable.')
  }
}

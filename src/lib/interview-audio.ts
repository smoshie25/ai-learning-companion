/** Ephemeral PCM playback; no audio is persisted or logged. */
export class InterviewAudioPlayer {
 private context?:AudioContext
 private sources=new Set<AudioBufferSourceNode>()
 private until=0
 async start() {this.context=new AudioContext({sampleRate:24000});await this.context.resume()}
 get speaking() {return !!this.context&&this.until>this.context.currentTime}
 play(pcm:string) {
  if(!this.context)return
  const bytes=Uint8Array.from(atob(pcm),c=>c.charCodeAt(0))
  if(!bytes.length||bytes.length%2||bytes.length>48000)throw new Error('Invalid audio output')
  const view=new DataView(bytes.buffer);const buffer=this.context.createBuffer(1,bytes.length/2,24000);const data=buffer.getChannelData(0)
  for(let i=0;i<data.length;i++)data[i]=view.getInt16(i*2,true)/32768
  const start=Math.max(this.context.currentTime+0.01,this.until)
  if(start-this.context.currentTime>12)throw new Error('Playback exceeded buffer limit')
  const source=this.context.createBufferSource();source.buffer=buffer;source.connect(this.context.destination);this.sources.add(source)
  source.onended=()=>{source.disconnect();this.sources.delete(source)}
  source.start(start);this.until=start+buffer.duration
 }
 async stop() {for(const source of this.sources){try{source.stop()}catch{}source.disconnect()}this.sources.clear();await this.context?.close().catch(()=>{});this.context=undefined;this.until=0}
}

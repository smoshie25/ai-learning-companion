// Node owns stdio; Electron owns the MCP server and OS credential access.
// A private one-use IPC stream avoids Electron's unusable Windows GUI stdin.
const {spawn}=require('node:child_process')
const {createServer}=require('node:net')
const {randomBytes,timingSafeEqual}=require('node:crypto')
const fs=require('node:fs')
const os=require('node:os')
const path=require('node:path')
const nonce=randomBytes(32).toString('hex')
const directory=process.platform==='win32'?null:fs.mkdtempSync(path.join(os.tmpdir(),'companion-mcp-'))
if(directory)fs.chmodSync(directory,0o700)
const address=process.platform==='win32'?'\\\\.\\pipe\\companion-mcp-'+randomBytes(32).toString('hex'):path.join(directory,'server.sock')
let child;let active;let authenticated=false
const cleanup=()=>{active?.destroy();server.close();if(directory){try{fs.unlinkSync(address)}catch{}try{fs.rmdirSync(directory)}catch{}}}
const server=createServer(socket=>{
 let buffer=Buffer.alloc(0)
 const authenticate=chunk=>{
  buffer=Buffer.concat([buffer,chunk]);if(buffer.length>2048){socket.destroy();return}
  const end=buffer.indexOf(10);if(end<0)return
  const proof=buffer.subarray(0,end);const expected=Buffer.from(nonce)
  if(authenticated||proof.length!==expected.length||!timingSafeEqual(proof,expected)){socket.destroy();return}
  authenticated=true;clearTimeout(timer);active=socket;socket.pause();socket.off('data',authenticate);server.close()
  const remainder=buffer.subarray(end+1);if(remainder.length)socket.unshift(remainder)
  socket.pipe(process.stdout)
  process.stdin.pipe(socket)
  socket.on('error',()=>{});socket.on('close',()=>{process.stdin.unpipe(socket);child?.kill()})
 }
 socket.on('data',authenticate);socket.on('error',()=>{})
})
const timer=setTimeout(()=>{process.stderr.write('Companion MCP startup timed out.\n');child?.kill();cleanup();process.exit(1)},120000)
server.on('error',()=>{process.stderr.write('The private MCP transport could not start.\n');clearTimeout(timer);cleanup();process.exit(1)})
server.listen(address,()=>{
 const env={...process.env,COMPANION_MCP_NONCE:nonce};delete env.ELECTRON_RUN_AS_NODE
 child=spawn(require('electron'),[path.resolve(__dirname,'..'),'--mcp','--mcp-transport='+address,...process.argv.slice(2)],{env,stdio:['ignore','pipe','pipe'],windowsHide:true})
 child.stdout.pipe(process.stderr)
 child.stderr.pipe(process.stderr)
 child.on('error',()=>{process.stderr.write('The Companion MCP runtime could not start.\n');clearTimeout(timer);cleanup();process.exit(1)})
 child.on('exit',code=>{clearTimeout(timer);cleanup();process.exit(code??1)})
})
process.on('SIGINT',()=>{child?.kill();clearTimeout(timer);cleanup();process.exit(0)})
process.on('SIGTERM',()=>{child?.kill();clearTimeout(timer);cleanup();process.exit(0)})

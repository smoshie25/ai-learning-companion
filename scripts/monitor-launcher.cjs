const {spawn}=require('node:child_process')
const path=require('node:path')
const args=process.argv.slice(2)
if(args.some(a=>!/^--user-data-dir=.+$/.test(a))){process.stderr.write('Usage: node scripts/monitor-launcher.cjs [--user-data-dir=ABSOLUTE_PROFILE]\n');process.exit(1)}
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE
const child=spawn(require('electron'),[path.resolve(__dirname,'..'),'--monitor',...args],{env,stdio:['ignore','pipe','pipe'],windowsHide:true})
child.stdout.pipe(process.stdout);child.stderr.pipe(process.stderr)
child.on('error',()=>{process.stderr.write('Monitoring worker could not start.\n');process.exit(1)})
child.on('exit',code=>process.exit(code??1))
process.on('SIGINT',()=>child.kill());process.on('SIGTERM',()=>child.kill())

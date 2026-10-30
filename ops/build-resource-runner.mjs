import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {assertBuildDiskSpace} from './build-disk-space.mjs';

export function memorySample(procRoot='/proc',cgroupRoot='/sys/fs/cgroup'){
  let availableMiB=null,currentMiB=null,peakMiB=null,swapMiB=null;
  try{const text=fs.readFileSync(path.join(procRoot,'meminfo'),'utf8');availableMiB=Number(text.match(/^MemAvailable:\s+(\d+)/m)?.[1])/1024;}catch{}
  try{
    const relative=fs.readFileSync(path.join(procRoot,'self/cgroup'),'utf8').split('\n').find(line=>line.startsWith('0::'))?.slice(3);
    if(relative&&!relative.split('/').includes('..')){
      const dir=path.join(cgroupRoot,relative);
      const read=name=>Number(fs.readFileSync(path.join(dir,name),'utf8'))/1048576;
      currentMiB=read('memory.current');peakMiB=read('memory.peak');swapMiB=read('memory.swap.current');
    }
  }catch{}
  return {availableMiB,currentMiB,peakMiB,swapMiB};
}
export async function runGuarded(label,command,args,env=process.env){
  if (env.BUILD_DISK_PATH) console.log('[build-disk] '+JSON.stringify(assertBuildDiskSpace([env.BUILD_DISK_PATH], {minimumMiB:Number(env.BUILD_MIN_DISK_MB || 2048)})));
  const heap=Number(env.BUILD_NODE_HEAP_MB||640);
  if(!Number.isInteger(heap)||heap<256||heap>4096)throw Error('Invalid BUILD_NODE_HEAP_MB');
  const before=memorySample();
  const minimum=Number(env.BUILD_MIN_AVAILABLE_MB||1024);
  if(Number.isFinite(before.availableMiB)&&before.availableMiB<minimum)throw Error(`Available memory ${before.availableMiB.toFixed(0)} MiB is below required ${minimum} MiB; current release unchanged`);
  let peak=0,minAvailable=Infinity,peakSwap=0;
  const started=Date.now();
  const sample=()=>{const value=memorySample();if(Number.isFinite(value.peakMiB))peak=Math.max(peak,value.peakMiB);if(Number.isFinite(value.availableMiB))minAvailable=Math.min(minAvailable,value.availableMiB);if(Number.isFinite(value.swapMiB))peakSwap=Math.max(peakSwap,value.swapMiB);return value;};
  const output=event=>console.log('[build-memory] '+JSON.stringify({event,label,elapsedSeconds:Math.round((Date.now()-started)/1000),heapMiB:heap,...sample()}));
  output('start');
  const options=String(env.NODE_OPTIONS||'').replace(/--max[-_]old[-_]space[-_]size(?:=|\s+)\d+/g,'').trim();
  const child=spawn(command,args,{stdio:'inherit',env:{...env,NODE_OPTIONS:`${options} --max-old-space-size=${heap}`.trim()}});
  const timer=setInterval(()=>output('sample'),5000);
  let stopping=false;
  const stop=signal=>{stopping=true;child.kill(signal);};
  const term=()=>stop('SIGTERM'),interrupt=()=>stop('SIGINT');
  process.once('SIGTERM',term);process.once('SIGINT',interrupt);
  const result=await new Promise(resolve=>{child.once('error',error=>resolve({code:1,error:error.message}));child.once('exit',(code,signal)=>resolve({code:code??1,signal}));});
  clearInterval(timer);process.removeListener('SIGTERM',term);process.removeListener('SIGINT',interrupt);sample();
  console.log('[build-memory] '+JSON.stringify({event:'complete',label,...result,stopping,elapsedSeconds:Math.round((Date.now()-started)/1000),peakMiB:peak||null,minAvailableMiB:Number.isFinite(minAvailable)?minAvailable:null,peakSwapMiB:peakSwap}));
  return result.code;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [label,command,...args]=process.argv.slice(2);
  if(!label||!command)throw Error('Usage: build-resource-runner.mjs <label> <command> [args...]');
  try{process.exitCode=await runGuarded(label,command,args);}catch(error){console.error('[build-memory] '+error.message);process.exitCode=1;}
}

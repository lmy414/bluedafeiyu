import {spawn} from 'node:child_process';
export async function piJSON(prompt, {cwd, cli='D:/dev/tools/npm-global/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js'}={}) {
  return new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[cli,'--provider','cpa','--model','deepseek/deepseek-v4.1-flash','--thinking','off','--mode','json','--print','--no-tools','--no-extensions','--no-skills','--no-prompt-templates','--no-context-files','--no-session','--offline'],{cwd,stdio:['pipe','pipe','pipe'],windowsHide:true});
    let pending='',final,stderr='';
    const timer=setTimeout(()=>{child.kill();reject(Error('PI timed out'));},12*60*1000);
    child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
    child.stdout.on('data',chunk=>{pending+=chunk;let nl;while((nl=pending.indexOf('\n'))>=0){const line=pending.slice(0,nl);pending=pending.slice(nl+1);try{const event=JSON.parse(line);if(event.type==='message_end'&&event.message?.role==='assistant')final=event.message;}catch{}}});
    child.stderr.on('data',chunk=>stderr+=chunk);
    child.on('error',error=>{clearTimeout(timer);reject(error);});
    child.on('close',code=>{clearTimeout(timer);if(code!==0||!final||final.stopReason==='error')return reject(Error(final?.errorMessage||stderr.slice(-500)||'PI failed '+code));try{const text=final.content.filter(c=>c.type==='text').map(c=>c.text).join('').trim().replace(/^```(?:json)?\s*|\s*```$/g,'');resolve({data:JSON.parse(text),model:final.model,provider:final.provider,usage:final.usage});}catch(error){reject(error);}});
    child.stdin.end(prompt);
  });
}

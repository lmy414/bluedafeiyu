import fs from 'node:fs';
import { spawn } from 'node:child_process';

// PI RPC uses the user's configured provider and credentials; secrets never enter logs.
export function piVision(prompt, images, { cwd = process.cwd(), timeoutMs = 180000 } = {}) {
  const cli = process.env.PI_CLI || 'D:/dev/tools/npm-global/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js';
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, '--provider', 'cpa', '--model', 'deepseek/deepseek-v4.1-flash', '--thinking', 'off', '--mode', 'rpc', '--no-tools', '--no-extensions', '--no-skills', '--no-prompt-templates', '--no-context-files', '--no-session', '--offline'], { cwd, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let pending = '', final, settled = false, stderr = '';
    const finish = (error, result) => { if (settled) return; settled = true; clearTimeout(timer); child.kill(); error ? reject(error) : resolve(result); };
    const timer = setTimeout(() => finish(new Error('PI vision timed out')), timeoutMs);
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      pending += chunk;
      let nl;
      while ((nl = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, nl); pending = pending.slice(nl + 1);
        let event; try { event = JSON.parse(line); } catch { continue; }
        if (event.type === 'response' && event.success === false) finish(new Error(event.error || 'PI rejected prompt'));
        if (event.type === 'message_end' && event.message?.role === 'assistant') final = event.message;
        if (event.type === 'agent_settled') {
          if (!final || ['error', 'aborted'].includes(final.stopReason)) return finish(new Error(final?.errorMessage || 'PI returned no final answer'));
          try {
            const text = final.content.filter(x => x.type === 'text').map(x => x.text).join('').trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
            finish(null, { data: JSON.parse(text), model: final.model, provider: final.provider, usage: final.usage });
          } catch (error) { finish(error); }
        }
      }
    });
    child.stderr.on('data', chunk => stderr += chunk);
    child.on('error', error => finish(error));
    child.on('close', code => { if (!settled) finish(new Error('PI exited ' + code + ': ' + stderr.slice(-400))); });
    child.stdin.write(JSON.stringify({ id: 'classify', type: 'prompt', message: prompt, images: images.map(file => ({ type: 'image', data: fs.readFileSync(file).toString('base64'), mimeType: file.endsWith('.png') ? 'image/png' : file.endsWith('.jpg') ? 'image/jpeg' : 'image/webp' })) }) + '\n');
  });
}

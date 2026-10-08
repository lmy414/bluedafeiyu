// 只输出聚合计数；独立日志来自 nginx-ai-content.conf，支持 logrotate 的 .gz。
import fs from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
const args = process.argv.slice(2);
const value = key => args.includes(key) ? args[args.indexOf(key) + 1] : '';
const start = Date.parse(value('--from')), end = Date.parse(value('--until'));
if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) throw new Error('需要 --from 和 --until，使用含时区的 ISO 时间，结束时间不含边界');
const file = value('--log') || '/var/log/nginx/dafeiyu-ai-access.log';
const months = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
const groups = new Map();
let checksExcluded = 0, matched = 0;
const files = fs.readdirSync(path.dirname(file)).filter(name => name === path.basename(file) || name.startsWith(path.basename(file) + '.'));
for (const name of files) {
  const raw = fs.readFileSync(path.join(path.dirname(file), name));
  const lines = (name.endsWith('.gz') ? gunzipSync(raw) : raw).toString('utf8').split('\n');
  for (const line of lines) {
    const match = line.match(/\[(\d{2})\/(\w{3})\/(\d{4}):(\d{2}:\d{2}:\d{2}) ([+-]\d{4})\] "(?:GET|HEAD) ([^ ]+) [^"]+" (\d+) \S+ "[^"]*" "([^"]*)"/);
    if (!match) continue;
    const [, day, month, year, time, offset, route, status, ua] = match;
    const timestamp = Date.parse(`${year}-${String(months[month]).padStart(2, '0')}-${day}T${time}${offset.slice(0, 3)}:${offset.slice(3)}`);
    if (!(timestamp >= start && timestamp < end)) continue;
    if (ua.includes('BlueFish-AI-Check/1.0')) { checksExcluded++; continue; }
    const pathname = route.split('?')[0];
    if (pathname !== '/llms.txt' && !pathname.endsWith('.html.md')) continue;
    const client = ua.match(/OAI-SearchBot|ChatGPT-User|GPTBot|Claude-SearchBot|Claude-User|ClaudeBot|PerplexityBot|Perplexity-User|Google-Extended|Googlebot|bingbot|Bytespider|Amazonbot/i)?.[0] || 'other';
    const date = new Date(timestamp + 8 * 3600000).toISOString().slice(0, 10);
    const key = `${date}|${pathname === '/llms.txt' ? 'llms.txt' : 'markdown'}|${client}|${status}`;
    const group = groups.get(key) || { date, resource: pathname === '/llms.txt' ? 'llms.txt' : 'markdown', claimedClient: client, status: Number(status), requests: 0 };
    group.requests++; groups.set(key, group); matched++;
  }
}
console.log(JSON.stringify({ from: value('--from'), until: value('--until'), timeZone: 'Asia/Shanghai', logFiles: files.length,
  requests: matched, checksExcluded, groups: [...groups.values()], note: 'User-Agent 只表示自报身份，未核实爬虫 IP；请求次数不等于推荐次数。' }, null, 2));

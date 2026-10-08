import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { reportAiReferrals, isAiSource } from '../report-ai-referrals.mjs';

test('来源报表隔离站点数据流，区分 AI 来源和普通来源，保留数据限制', async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'blue-fish-ai-test-'));
  try {
    const credentials = path.join(temporary, 'test-account.json');
    const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
    fs.writeFileSync(credentials, JSON.stringify({ type: 'service_account', client_email: 'test@example.invalid', private_key: privateKey }));
    const requests = [];
    const fetchImpl = async (url, init) => {
      if (url.includes('oauth2')) return Response.json({ access_token: 'synthetic-test-token' });
      const body = JSON.parse(init.body); requests.push(body);
      const traffic = body.metrics[0].name === 'sessions';
      return Response.json({ dimensionHeaders: body.dimensions, metricHeaders: body.metrics,
        metadata: { timeZone: 'Asia/Shanghai', subjectToThresholding: true }, rowCount: traffic ? 2 : 1,
        rows: (traffic ? [['20261007', 'chatgpt.com / referral', '/works/one.html', '3', '2', '5'], ['20261007', 'google / organic', '/', '7', '4', '9']]
          : [['20261007', 'chatgpt.com / referral', 'work_download', '2']]).map(row => ({ dimensionValues: row.slice(0, 3).map(value => ({ value })), metricValues: row.slice(3).map(value => ({ value })) })) });
    };
    const result = await reportAiReferrals({ startDate: '2026-10-01', endDate: '2026-10-07', env: { GA4_PROPERTY_ID: '123', GA4_STREAM_ID: '456', GOOGLE_APPLICATION_CREDENTIALS: credentials }, fetchImpl });
    assert.equal(result.totalSessions, 10); assert.equal(result.aiSessions, 3); assert.equal(result.limited, true);
    assert.equal(result.aiLandingPages[0].landingPage, '/works/one.html'); assert.equal(result.aiEvents[0].count, 2);
    for (const body of requests) assert.equal(body.dimensionFilter.andGroup.expressions[0].filter.stringFilter.value, '456');
    assert.ok(!JSON.stringify(result).includes('synthetic-test-token'));
    assert.equal(isAiSource('chatgpt.com.evil.example / referral'), false);
    assert.equal(isAiSource('bing / organic'), false);
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
});

test('独立访问日志跨压缩轮转聚合，按上海时间分日，排除验收请求', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'blue-fish-ai-log-test-'));
  try {
    const file = path.join(temporary, 'access.log');
    const line = (route, status, ua) => `192.0.2.1 - - [08/Oct/2026:17:00:00 +0000] "GET ${route} HTTP/1.1" ${status} 100 "-" "${ua}"\n`;
    fs.writeFileSync(file, line('/llms.txt', 200, 'OAI-SearchBot') + line('/llms.txt', 200, 'BlueFish-AI-Check/1.0'));
    fs.writeFileSync(file + '.1.gz', gzipSync(line('/works/one.html.md', 304, 'Claude-User') + line('/missing.html.md', 404, 'other')));
    const result = spawnSync(process.execPath, [path.resolve(import.meta.dirname, '../report-ai-reads.mjs'), '--log', file,
      '--from', '2026-10-09T00:00:00+08:00', '--until', '2026-10-10T00:00:00+08:00'], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const data = JSON.parse(result.stdout);
    assert.equal(data.requests, 3); assert.equal(data.checksExcluded, 1); assert.equal(data.logFiles, 2);
    assert.ok(data.groups.every(row => row.date === '2026-10-09'));
    assert.ok(!result.stdout.includes('192.0.2.1'));
    assert.ok(data.groups.some(row => row.status === 404));
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
});

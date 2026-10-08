// 只读报表：复用现有 GA4 服务账号签名，输出聚合来源，不输出令牌或访客身份。
import { accessToken, analyticsConfig } from '../../admin/src/lib/analytics.ts';
import { pathToFileURL } from 'node:url';

export const isAiSource = value => /(?:^|\.)(?:chatgpt\.com|chat\.openai\.com|perplexity\.ai|claude\.ai|gemini\.google\.com|copilot\.microsoft\.com|deepseek\.com|doubao\.com|kimi\.com|kimi\.moonshot\.cn|grok\.com|poe\.com|yuanbao\.tencent\.com|metaso\.cn|chat\.qwen\.ai|tongyi\.aliyun\.com|chat\.mistral\.ai)$/.test(String(value).split(' / ')[0].trim().toLowerCase());
const metricValue = value => {
  const number = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(number)) throw new Error('GA4 返回无效计数');
  return number;
};
export async function reportAiReferrals({ startDate, endDate, env = process.env, fetchImpl = fetch }) {
  for (const date of [startDate, endDate]) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || new Date(date + 'T00:00:00Z').toISOString().slice(0, 10) !== date) throw new Error('日期必须是 YYYY-MM-DD');
  }
  if (startDate > endDate) throw new Error('开始日期晚于结束日期');
  const cfg = analyticsConfig(env);
  if (!cfg.configured) throw new Error('GA4 尚未配置');
  const token = await accessToken(cfg.credentialsFile, fetchImpl);
  let limited = false, timeZone;
  async function query(dimensions, metrics, eventNames) {
    const rows = [];
    const expressions = [{ filter: { fieldName: 'streamId', stringFilter: { matchType: 'EXACT', value: cfg.streamId } } }];
    if (eventNames) expressions.push({ filter: { fieldName: 'eventName', inListFilter: { values: eventNames } } });
    for (;;) {
      const response = await fetchImpl(`https://analyticsdata.googleapis.com/v1beta/properties/${cfg.propertyId}:runReport`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ dateRanges: [{ startDate, endDate }], dimensions: dimensions.map(name => ({ name })), metrics: metrics.map(name => ({ name })),
          dimensionFilter: { andGroup: { expressions } }, orderBys: dimensions.map(dimensionName => ({ dimension: { dimensionName } })), limit: '10000', offset: String(rows.length) }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error(`GA4 报表读取失败（HTTP ${response.status}）`);
      const data = await response.json();
      if (data.dimensionHeaders?.map(x => x.name).join(',') !== dimensions.join(',') || data.metricHeaders?.map(x => x.name).join(',') !== metrics.join(',')) throw new Error('GA4 报表字段不匹配');
      limited ||= Boolean(data.metadata?.dataLossFromOtherRow || data.metadata?.subjectToThresholding || data.metadata?.samplingMetadatas?.length);
      timeZone = data.metadata?.timeZone || timeZone;
      const batch = data.rows || [];
      rows.push(...batch.map(row => ({ dimensions: row.dimensionValues.map(x => x.value), metrics: row.metricValues.map(x => metricValue(x.value)) })));
      if (rows.length >= (data.rowCount || 0)) return rows;
      if (!batch.length || rows.length > 100000) throw new Error('GA4 分页不完整');
    }
  }
  const traffic = await query(['date', 'sessionSourceMedium', 'landingPage'], ['sessions', 'engagedSessions', 'screenPageViews']);
  const events = await query(['date', 'sessionSourceMedium', 'eventName'], ['eventCount'], ['work_view', 'work_download']);
  const sources = new Map(), aiLandingPages = new Map();
  for (const row of traffic) {
    const [date, source, landingPage] = row.dimensions;
    const current = sources.get(source) || { source, ai: isAiSource(source), sessions: 0, engagedSessions: 0, pageViews: 0 };
    current.sessions += row.metrics[0]; current.engagedSessions += row.metrics[1]; current.pageViews += row.metrics[2];
    sources.set(source, current);
    if (current.ai) {
      const key = `${date}|${source}|${landingPage}`;
      const landing = aiLandingPages.get(key) || { date, source, landingPage, sessions: 0, engagedSessions: 0, pageViews: 0 };
      landing.sessions += row.metrics[0]; landing.engagedSessions += row.metrics[1]; landing.pageViews += row.metrics[2]; aiLandingPages.set(key, landing);
    }
  }
  const sourceRows = [...sources.values()].sort((a, b) => b.sessions - a.sessions);
  const aiSources = sourceRows.filter(x => x.ai);
  const aiEvents = events.filter(x => isAiSource(x.dimensions[1])).map(x => ({ date: x.dimensions[0], source: x.dimensions[1], event: x.dimensions[2], count: x.metrics[0] }));
  return { version: 1, generatedAt: new Date().toISOString(), startDate, endDate, timeZone, streamId: cfg.streamId, limited,
    totalSessions: sourceRows.reduce((n, x) => n + x.sessions, 0), aiSessions: aiSources.reduce((n, x) => n + x.sessions, 0),
    aiSources, aiLandingPages: [...aiLandingPages.values()], aiEvents, sources: sourceRows,
    notes: ['AI 来源按可识别域名统计；没有 referrer 的推荐访问可能归为直接访问。', 'sessions 是会话，work_download 是下载按钮点击。来源访问不能证明 llms.txt 的因果效果。'] };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const get = key => args[args.indexOf(key) + 1];
  reportAiReferrals({ startDate: args.includes('--start') ? get('--start') : '', endDate: args.includes('--end') ? get('--end') : '' })
    .then(report => console.log(JSON.stringify(report, null, 2)))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}

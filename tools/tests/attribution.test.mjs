import assert from 'node:assert/strict';
import test from 'node:test';
import { submissionAttribution, workAttribution, safeHomepage } from '../../admin/src/lib/attribution.mjs';
import { fieldsFromSections, parseIssueForm } from '../intake/core.mjs';

test('署名独立于来源，主页可留空，不署名忽略残留名字和链接', () => {
  const source = { author: '原作者', sourceUrl: 'https://source.example/art' };
  const submitter = submissionAttribution({ credit: 'named', creditName: ' 小鱼 ', creditUrl: 'https://home.example/me' });
  assert.deepEqual(workAttribution({ submitter, origin: source }), { name: '小鱼', url: 'https://home.example/me', explicit: true });
  assert.deepEqual(source, { author: '原作者', sourceUrl: 'https://source.example/art' });
  assert.equal(submissionAttribution({ credit: 'named', creditName: '小鱼' }).url, '');
  const anonymous = submissionAttribution({ credit: 'anonymous', creditName: '不可公开', creditUrl: 'javascript:alert(1)' });
  assert.deepEqual(anonymous, { credit: 'anonymous', name: '', url: '', github: '' });
  assert.equal(workAttribution({ submitter: anonymous, origin: source }).name, '');
  assert.equal(submissionAttribution({}), null);
  assert.equal(workAttribution({ origin: source }).url, '', '不能把来源当成主页');
  assert.equal(workAttribution({ origin: source }).name, '原作者', '旧数据继续显示原有作者');
});

test('拒绝缺名字、过长名字、非法模式和危险主页', () => {
  for (const fields of [{ credit: 'named' }, { credit: 'named', creditName: 'a'.repeat(121) }, { credit: 'bogus' }, { creditName: '未选署名' }]) assert.throws(() => submissionAttribution(fields));
  for (const url of ['javascript:alert(1)', 'data:text/html,x', '//example.com', 'https://u:p@example.com', 'https://example.com/ x', 'not a URL']) {
    assert.equal(safeHomepage(url), '');
    assert.throws(() => submissionAttribution({ credit: 'named', creditName: '鱼', creditUrl: url }));
  }
});

test('GitHub 表单读取署名、主页与作品来源到各自字段', () => {
  const body = '### 是否署名\n\n署名\n\n### 署名名字（选择署名时必填）\n\n小鱼\n\n### 个人主页链接（可选）\n\nhttps://home.example/me\n\n### 来源链接\n\nhttps://source.example/art';
  const fields = fieldsFromSections(parseIssueForm(body));
  assert.equal(submissionAttribution(fields).url, 'https://home.example/me');
  assert.equal(fields.originUrl, 'https://source.example/art');
});

#!/usr/bin/env python3
"""Run inside the existing Hermes container after installing the plugin/skill.
Back up the relevant config first. No secrets are printed or copied into repo.
"""
import argparse
import json
import os
import shutil
from datetime import datetime
from pathlib import Path
import yaml

parser = argparse.ArgumentParser()
state = parser.add_mutually_exclusive_group()
state.add_argument('--enable', action='store_true', help='Explicitly enable the review job after checks')
state.add_argument('--disable', action='store_true', help='Explicitly disable the review job')
args = parser.parse_args()
os.environ.setdefault('HERMES_HOME', '/home/agent/.hermes')
home = Path(os.environ['HERMES_HOME'])
from cron.jobs import resolve_job_ref, update_job
job = resolve_job_ref('dafeiyu-review-cycle')
if not job: raise SystemExit('Existing review job not found; refusing to create a duplicate')
backup = home / 'backups' / ('editorial-' + datetime.now().strftime('%Y%m%d-%H%M%S'))
backup.mkdir(parents=True, mode=0o700)
shutil.copy2(home / 'config.yaml', backup / 'config.yaml')
(backup / 'review-job.json').write_text(json.dumps(job, ensure_ascii=False, indent=2))
cfg = yaml.safe_load((home / 'config.yaml').read_text())
enabled = cfg.setdefault('plugins', {}).setdefault('enabled', [])
if 'dafeiyu-editorial' not in enabled: enabled.append('dafeiyu-editorial')
# Per-model capability only. Preserve the job's current provider/model.
provider_id = str(job.get('provider') or '').strip()
model_id = str(job.get('model') or '').strip()
if not provider_id or not model_id:
    raise SystemExit('Review job has no pinned provider/model; refusing to guess or hardcode one')
provider_name = provider_id[len('custom:'):] if provider_id.startswith('custom:') else provider_id
provider = (cfg.get('providers') or {}).get(provider_name)
if not provider:
    provider = next((p for p in cfg.get('custom_providers', []) if p.get('name') == provider_name), None)
if not provider:
    raise SystemExit(f'Review job provider {provider_name!r} is missing from config; refusing to invent credentials or endpoints')
provider.setdefault('models', {}).setdefault(model_id, {})['supports_vision'] = True
(home / 'config.yaml').write_text(yaml.safe_dump(cfg, allow_unicode=True, sort_keys=False))
updates = {
    'prompt': '按 dafeiyu-editorial 技能处理署名、来源、授权备注和可恢复下架申请，以及后台补全、翻译任务、新投稿和 Bilibili 视频队列。每轮总计最多 3 条，只使用 dafeiyu_editorial 工具。先 sync/list requests，再对 videos 执行 sync/list，查 admin 和 submission。视频必须读取封面及预览帧，只有明确属于 AI 娘二创的视频通过；证据不足保留待复核，无关内容拒绝。申请证据不足、署名冲突、永久删除和功能/Bug 不自动处理。逐项校验保存；技术失败用 release，不转人工。没有任务时直接结束。禁止调用独立或辅助模型，禁止直接发布和人工批准。',
    'skills': ['dafeiyu-editorial'], 'skill': None, 'script': None,
    'no_agent': False,
    'enabled_toolsets': ['dafeiyu_editorial', 'no_mcp'],
}
if args.enable:
    updates['enabled'] = True
elif args.disable:
    updates['enabled'] = False
updated = update_job(job['id'], updates)
print(json.dumps({
    'backup': str(backup),
    'vision_capability': {'provider': provider_name, 'model': model_id},
    'job': {k: updated.get(k) for k in ['id', 'name', 'no_agent', 'enabled', 'script', 'skills', 'enabled_toolsets', 'model', 'provider']},
}, ensure_ascii=False))

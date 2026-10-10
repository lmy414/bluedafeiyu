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
parser.add_argument('--enable', action='store_true', help='Enable after tool and native-image smoke tests pass')
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
# Per-model capability only. Preserve the default model and other jobs.
provider = (cfg.get('providers') or {}).get('api.commandcode.ai')
if not provider:
    provider = next((p for p in cfg.get('custom_providers', []) if p.get('name') == 'api.commandcode.ai'), None)
if not provider: raise SystemExit('Existing Agent provider is missing; refusing to invent credentials or endpoints')
provider.setdefault('models', {}).setdefault('deepseek/deepseek-v4.1-flash', {})['supports_vision'] = True
(home / 'config.yaml').write_text(yaml.safe_dump(cfg, allow_unicode=True, sort_keys=False))
updated = update_job(job['id'], {
    'prompt': '按 dafeiyu-editorial 技能处理署名、来源、授权备注和可恢复下架申请，以及后台补全、翻译任务和新投稿。每轮总计最多 3 条，只使用 dafeiyu_editorial 工具。先 sync/list requests，再查 admin 和 submission。申请证据不足、署名冲突、永久删除和功能/Bug 不自动处理。逐项校验保存；技术失败用 release，不转人工。没有任务时直接结束。禁止调用独立或辅助模型，禁止直接发布和人工批准。',
    'skills': ['dafeiyu-editorial'], 'skill': None, 'script': None,
    'no_agent': False, 'model': 'deepseek/deepseek-v4.1-flash',
    'provider': 'custom:api.commandcode.ai',
    'enabled_toolsets': ['dafeiyu_editorial', 'no_mcp'],
    'enabled': args.enable,
})
print(json.dumps({'backup': str(backup), 'job': {k: updated.get(k) for k in ['id', 'name', 'no_agent', 'enabled', 'script', 'skills', 'enabled_toolsets', 'model', 'provider']}}, ensure_ascii=False))

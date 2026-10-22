"""Run inside the existing Hermes container; preserve execution and delivery settings."""
import json
import os
from datetime import datetime
from pathlib import Path
from cron.jobs import resolve_job_ref, update_job

job = resolve_job_ref('dafeiyu-publish')
if not job or not job.get('no_agent') or not job.get('script'):
    raise SystemExit('Existing script publish job required; no duplicate scheduler created')
home = Path(os.environ.get('HERMES_HOME', '/home/agent/.hermes'))
backup = home / 'backups' / ('video-publish-' + datetime.now().strftime('%Y%m%d-%H%M%S'))
backup.mkdir(parents=True, mode=0o700)
(backup / 'publish-job.json').write_text(json.dumps(job, ensure_ascii=False, indent=2))
updated = update_job(job['id'], {'schedule': '*/5 * * * *', 'enabled': True})
print(json.dumps({k: updated.get(k) for k in ['id', 'name', 'schedule', 'next_run_at', 'enabled', 'no_agent']}, ensure_ascii=False))

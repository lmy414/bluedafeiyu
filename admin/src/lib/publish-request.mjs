import fs from 'node:fs/promises';
import path from 'node:path';

// Link a complete file into the one-slot queue without replacing an accepted request.
// DB admission is advisory: two HTTP requests can pass its active-run check together.
export async function enqueuePublishRequest(targetDir, request) {
  const target = path.join(targetDir, 'publish.request');
  const temp = path.join(targetDir, `.publish.request.${request.runId}.tmp`);
  await fs.mkdir(targetDir, { recursive: true });
  let created = false;
  try {
    await fs.writeFile(temp, `${JSON.stringify(request)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    created = true;
    await fs.link(temp, target);
  } finally {
    // Cleanup must not turn successful queue admission into an HTTP failure.
    if (created) await fs.rm(temp, { force: true }).catch(() => undefined);
  }
}

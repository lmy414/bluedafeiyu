import { topicMembers, archiveName, downloadMembers, zipMembers, DownloadLimitError } from './topic-zip.js?v=1';

export function installTopicDownloads({ load, tx, toast }) {
  const dialog = document.querySelector('#topic-download-dialog');
  const status = dialog.querySelector('[data-topic-status]');
  const progress = dialog.querySelector('[data-topic-progress]');
  const failures = dialog.querySelector('[data-topic-failures]');
  const retry = dialog.querySelector('[data-topic-retry]');
  const save = dialog.querySelector('[data-topic-save]');
  const close = dialog.querySelector('[data-topic-close]');
  let session;

  function dispose() {
    if (!session) return;
    const old = session;
    session = null;
    old.controller.abort();
    if (old.url) URL.revokeObjectURL(old.url);
    old.files.clear();
    dialog.close();
    old.opener.focus();
  }
  function track(current) {
    if (typeof window.gtag === 'function') window.gtag('event', 'topic_download', {
      topic_id: current.topic.id, image_count: current.files.size,
      failed_count: current.works.length - current.files.size, transport_type: 'beacon',
    });
  }
  function download(current) {
    if (!current.url) return;
    const link = document.createElement('a');
    link.href = current.url;
    link.download = (current.files.size === current.works.length ? '' : tx('d.zipPartialPrefix','部分_')) + archiveName(current.topic);
    document.body.append(link);
    link.click();
    link.remove();
    track(current);
  }
  async function run(current) {
    current.busy = true;
    retry.hidden = save.hidden = failures.hidden = true;
    close.textContent = tx('d.zipCancel','取消');
    progress.hidden = false;
    try {
      const result = await downloadMembers(current.works, {
        signal: current.controller.signal, files: current.files,
        onProgress(done, total) {
          if (session !== current) return;
          progress.max = total; progress.value = done;
          status.textContent = tx('d.zipProgress','正在获取原图 {done} / {total}', { done, total });
        },
      });
      if (session !== current) return;
      failures.replaceChildren();
      for (const work of result.failed) {
        const li = document.createElement('li'); li.textContent = work.n; failures.append(li);
      }
      failures.hidden = !result.failed.length;
      retry.hidden = !result.failed.length;
      if (result.failed.length) {
        status.textContent = tx('d.zipFailed','已获取 {done} / {total} 张，{failed} 张失败。可以重试，或保存已成功的图片。', { done: current.files.size, total: current.works.length, failed: result.failed.length });
      } else status.textContent = tx('d.zipPacking','正在打包原图…');
      if (current.files.size) {
        const bytes = await zipMembers(current.works, current.files, current.zip);
        if (session !== current) return;
        if (current.url) URL.revokeObjectURL(current.url);
        current.url = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' }));
        save.hidden = false;
        save.textContent = result.failed.length ? tx('d.zipSavePartial','保存已成功的图片') : tx('d.zipSave','保存 ZIP');
        if (!result.failed.length) {
          status.textContent = tx('d.zipReady','{count} 张原图已打包，已发起下载。若未自动保存，请点击“保存 ZIP”。', { count: current.works.length });
          download(current);
        }
      }
    } catch (error) {
      if (session !== current) return;
      status.textContent = error instanceof DownloadLimitError
        ? tx('d.zipLimit','专题原图超过打包限制（总计 100 MB，单张 20 MB），未生成不完整的下载包。')
        : tx('d.zipError','打包失败，请关闭后重试。');
      // A size limit must never quietly offer a truncated topic.
      current.files.clear();
      retry.hidden = save.hidden = failures.hidden = true;
      if (current.url) { URL.revokeObjectURL(current.url); current.url = null; }
    } finally {
      if (session === current) {
        current.busy = false;
        progress.hidden = true;
        close.textContent = tx('d.zipClose','关闭');
      }
    }
  }
  document.addEventListener('click', async event => {
    const opener = event.target.closest('[data-download-topic]');
    if (!opener) return;
    if (session) { dialog.focus(); return; }
    const current = { opener, controller: new AbortController(), files: new Map(), busy: true };
    session = current;
    dialog.querySelector('h2').textContent = tx('d.zipTitle','专题原图打包');
    status.textContent = tx('d.zipLoading','正在读取专题…');
    progress.hidden = true;
    retry.hidden = save.hidden = failures.hidden = true;
    close.textContent = tx('d.zipCancel','取消');
    dialog.showModal();
    close.focus();
    try {
      const [data, library] = await Promise.all([load(), import('/vendor/fflate/fflate-0.8.2.js')]);
      if (session !== current) return;
      Object.assign(current, topicMembers(data, opener.dataset.downloadTopic), { zip: library.zip });
      dialog.querySelector('h2').textContent = current.topic.name + ' · ' + tx('d.zipTitle','专题原图打包');
      await run(current);
    } catch {
      if (session === current) { status.textContent = tx('d.zipError','打包失败，请关闭后重试。'); current.busy = false; close.textContent = tx('d.zipClose','关闭'); }
    }
  });
  retry.addEventListener('click', () => { if (session && !session.busy) run(session); });
  save.addEventListener('click', () => { if (session && !session.busy) download(session); });
  close.addEventListener('click', () => { const busy = session?.busy; dispose(); if (busy) toast(tx('d.zipCancelled','已取消打包')); });
  dialog.addEventListener('cancel', event => { event.preventDefault(); const busy = session?.busy; dispose(); if (busy) toast(tx('d.zipCancelled','已取消打包')); });
}

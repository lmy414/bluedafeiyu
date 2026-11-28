type Turnstile = {
  render: (element: HTMLElement, options: {
    sitekey: string;
    theme: 'auto';
    callback: () => void;
    'response-field-name': string;
    'error-callback': () => void;
    'expired-callback': () => void;
    'timeout-callback': () => void;
  }) => string;
  reset: (id: string) => void;
};

interface TurnstileWindow extends Window {
  turnstile?: Turnstile;
  dafeiyuTurnstileReady?: () => void;
}

let widgetPromise: Promise<Turnstile> | undefined;
function turnstile() {
  const host = window as TurnstileWindow;
  widgetPromise ??= new Promise<Turnstile>((resolve, reject) => {
    if (host.turnstile) { resolve(host.turnstile); return; }
    host.dafeiyuTurnstileReady = () => {
      const widget = host.turnstile;
      if (widget) resolve(widget);
      else reject(new Error('Turnstile unavailable'));
      delete host.dafeiyuTurnstileReady;
    };
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=dafeiyuTurnstileReady';
    script.async = true;
    script.addEventListener('error', () => reject(new Error('Turnstile unavailable')), { once: true });
    document.head.append(script);
  });
  return widgetPromise;
}

function initializeUpload(form: HTMLFormElement) {
  const fileInput = form.querySelector<HTMLInputElement>('.upload-input');
  if (!fileInput) return;
  const input = fileInput;
  const field = input.closest<HTMLElement>('[data-upload]')!;
  const workspace = form.closest<HTMLElement>('[data-submit-workspace]')!;
  const zone = field.querySelector<HTMLElement>('[data-dropzone]')!;
  const error = field.querySelector<HTMLElement>('[data-upload-error]')!;
  const clear = field.querySelector<HTMLButtonElement>('[data-upload-clear]')!;
  const emptyLabel = zone.querySelector<HTMLElement>('[data-upload-empty-label]')!;
  const replaceLabel = zone.querySelector<HTMLElement>('[data-upload-replace-label]')!;
  const empty = workspace.querySelector<HTMLElement>('[data-file-empty]')!;
  const selected = workspace.querySelector<HTMLElement>('[data-file-selected]')!;
  const inline = workspace.querySelector<HTMLElement>('[data-upload-selected]')!;
  const images = [...workspace.querySelectorAll<HTMLImageElement>('[data-file-image]')];
  const names = workspace.querySelectorAll<HTMLElement>('[data-file-name]');
  const metadata = workspace.querySelectorAll<HTMLElement>('[data-file-meta]');
  const archive = form.dataset.submit === 'zip';
  const allowed = input.accept.split(',');
  const maxBytes = (archive ? 32 : 10) * 1024 ** 2;
  const format = new Intl.NumberFormat(document.documentElement.lang, { maximumFractionDigits: 1 });
  let previewUrl: string | undefined;
  let dragDepth = 0;

  const setError = (message = '') => {
    input.setCustomValidity(message);
    if (message) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
    error.textContent = message;
  };
  const discardPreview = () => {
    for (const image of images) {
      image.removeAttribute('src');
      image.parentElement!.hidden = true;
    }
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = undefined;
  };
  function render() {
    discardPreview();
    setError();
    const file = input.files?.[0];
    emptyLabel.hidden = Boolean(file);
    replaceLabel.hidden = inline.hidden = !file;
    empty.hidden = Boolean(file);
    selected.hidden = !file;
    if (!file) return;
    const size = file.size < 1024 ? `${format.format(file.size)} B` : file.size < 1024 ** 2 ? `${format.format(file.size / 1024)} KB` : `${format.format(file.size / 1024 ** 2)} MB`;
    for (const label of names) label.textContent = file.name;
    for (const label of metadata) label.textContent = size;
    const extension = /\.[^.]+$/.exec(file.name.toLowerCase())?.[0] ?? '';
    if (!file.size || file.size > maxBytes) { setError(form.dataset.size); return; }
    if (!allowed.includes(file.type.toLowerCase()) && !allowed.includes(extension)) { setError(field.dataset.formatError); return; }
    if (archive) return;
    const image = images[0]!;
    const url = URL.createObjectURL(file);
    previewUrl = url;
    for (const view of images) view.src = url;
    void image.decode().then(() => {
      if (previewUrl !== url) return;
      for (const view of images) view.parentElement!.hidden = false;
      const details = `${image.naturalWidth} × ${image.naturalHeight} · ${size}`;
      for (const label of metadata) label.textContent = details;
    }).catch(() => {
      if (previewUrl !== url) return;
      discardPreview();
      setError(field.dataset.decodeError);
    });
  }

  function useFiles(files: FileList) {
    if (files.length !== 1) {
      error.textContent = field.dataset.singleError ?? '';
      return;
    }
    input.files = files;
    render();
  }

  const carryingFiles = (event: DragEvent) => event.dataTransfer?.types.includes('Files');
  zone.addEventListener('dragenter', event => {
    if (!carryingFiles(event)) return;
    event.preventDefault();
    dragDepth++;
    zone.dataset.dragging = '';
  });
  zone.addEventListener('dragover', event => {
    if (!carryingFiles(event)) return;
    event.preventDefault();
    event.dataTransfer!.dropEffect = 'copy';
  });
  zone.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) delete zone.dataset.dragging;
  });
  zone.addEventListener('drop', event => {
    if (!carryingFiles(event)) return;
    event.preventDefault();
    dragDepth = 0;
    delete zone.dataset.dragging;
    useFiles(event.dataTransfer!.files);
  });
  if (!archive) document.addEventListener('paste', event => {
    const files = event.clipboardData?.files;
    if (event.defaultPrevented || !files?.length || !Array.from(files).some(file => file.type.startsWith('image/'))) return;
    event.preventDefault();
    useFiles(files);
  });
  input.addEventListener('change', render);
  clear.addEventListener('click', () => { input.value = ''; render(); input.focus(); });
  form.addEventListener('reset', () => queueMicrotask(render));
  window.addEventListener('pagehide', event => { if (!event.persisted) discardPreview(); });
  render();
}

export function initializeSubmission() {
  const form = document.querySelector<HTMLFormElement>('[data-submit]');
  if (!form) return;
  initializeUpload(form);
  const slot = form.querySelector<HTMLElement>('[data-turnstile-sitekey]');
  const button = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  const message = form.querySelector<HTMLElement>('[data-submit-message]');
  if (!slot?.dataset.turnstileSitekey || !button || !message) return;
  const { dataset } = form;
  const sitekey = slot.dataset.turnstileSitekey;
  let widget: Turnstile;
  let widgetId: string;
  let busy = false;
  let verified = false;
  const publishMessage = (text: string | undefined, error?: boolean) => {
    message.textContent = text || '';
    if (error === undefined) message.removeAttribute('data-error');
    else message.dataset.error = String(error);
    if (error) message.focus();
  };
  const invalidate = () => { verified = false; button.disabled = true; };
  void turnstile().then((api) => {
    widget = api;
    widgetId = widget.render(slot, {
      sitekey, theme: 'auto', 'response-field-name': 'turnstileToken',
      callback: () => {
        verified = true;
        button.disabled = busy;
        if (message.textContent === dataset.verify) publishMessage('');
      },
      'error-callback': () => { invalidate(); publishMessage(dataset.offline); },
      'expired-callback': invalidate,
      'timeout-callback': invalidate,
    });
  }).catch(() => publishMessage(dataset.offline));

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy || !form.reportValidity()) return;
    const data = new FormData(form);
    if (!verified || !data.get('turnstileToken')) { publishMessage(dataset.verify, true); return; }
    const archive = dataset.submit === 'zip';
    if (dataset.submit !== 'creator') {
      const file = data.get(archive ? 'zip' : 'image');
      if (!(file instanceof File) || !file.size || file.size > (archive ? 32 : 10) * 1024 * 1024) { publishMessage(dataset.size, true); return; }
      const primary = String(data.get('character') ?? '');
      data.set('characterIds', JSON.stringify([...new Set([primary, ...data.getAll('characterIds')])].filter(Boolean)));
      const name = String(data.get('creditName') ?? '').trim();
      if (!name && data.get('creditUrl')) { publishMessage(dataset.invalid, true); form.querySelector<HTMLInputElement>('[name="creditName"]')?.focus(); return; }
      data.set('credit', name ? 'named' : 'anonymous');
      if (!name) { data.delete('creditName'); data.delete('creditUrl'); }
      else if (!data.get('creditUrl')) data.delete('creditUrl');
    }
    busy = true;
    button.disabled = true;
    form.setAttribute('aria-busy', 'true');
    publishMessage(dataset.sending);
    try {
      const response = await fetch(form.action, { method: 'POST', headers: { Accept: 'application/json' }, body: data, credentials: 'same-origin', signal: AbortSignal.timeout(archive ? 120_000 : 45_000) });
      if (response.ok) {
        const result = await response.json() as { ok?: boolean; accepted?: number; duplicates?: number };
        if (!result.ok) throw new Error('Submission unconfirmed');
        form.reset();
        publishMessage(archive && result.accepted !== undefined ? `${dataset.success ?? ''} ${result.accepted} / ${result.accepted + (result.duplicates ?? 0)}` : dataset.success, false);
      } else {
        const messages: Record<number, string | undefined> = { 400: dataset.invalid, 403: dataset.verify, 409: dataset.duplicate, 413: dataset.size, 422: dataset.invalid, 429: dataset.limit };
        publishMessage(messages[response.status] ?? dataset.error, true);
      }
    } catch { publishMessage(dataset.error, true); }
    finally {
      busy = false;
      invalidate();
      form.removeAttribute('aria-busy');
      widget?.reset(widgetId);
    }
  });
}

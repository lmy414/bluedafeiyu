// Bake the custom homepage controls with the same locale as the page URL.
export function localizeHome(document,api) {
  if(!document.querySelector('.home-page'))return;
  const current=api.current;
  for(const card of document.querySelectorAll('.character-index-card')){
    const label=card.querySelector('[data-character-name]');
    const name=api.characterName(label.getAttribute('data-character-name'),label.getAttribute('data-character-label'));
    label.textContent=name;
    card.querySelector('img').setAttribute('alt',name);
  }
  const value={zh:'zh-CN','zh-Hant':'zh-TW',en:'en',ja:'ja'}[current];
  const label={zh:'简中','zh-Hant':'繁中',en:'EN',ja:'日本語'}[current];
  const trigger=document.querySelector('#lang');
  trigger.querySelector('span').textContent=label;
  trigger.setAttribute('aria-label',label);
  for(const option of document.querySelectorAll('#language-options [role=option]'))option.setAttribute('aria-selected',String(option.dataset.value===value));
}

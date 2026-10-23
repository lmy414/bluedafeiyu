export function videoCoverURL(source, width = 480) {
  try {
    const url = new URL(source);
    if (!/^https?:$/.test(url.protocol) || !/(^|\.)hdslb\.com$/.test(url.hostname)) return source;
    url.protocol = 'https:';
    url.pathname = url.pathname.split('@')[0] + `@${width}w_${Math.round(width*9/16)}h_1c.webp`;
    return url.href;
  } catch {return source;}
}

export function videoCoverAttributes(source, escape) {
  return `src="${escape(videoCoverURL(source))}" srcset="${[320,480,640].map(width=>escape(videoCoverURL(source,width))+' '+width+'w').join(', ')}" sizes="(max-width:760px) 46vw, (max-width:1050px) 28vw, (max-width:1350px) 22vw, 18vw" decoding="async" referrerpolicy="no-referrer"`;
}

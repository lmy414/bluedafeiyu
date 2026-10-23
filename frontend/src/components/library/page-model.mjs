import crypto from 'node:crypto';
const digest=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

// Detail templates stay lazy during dependency analysis. Selected recommendations are
// recomputed from all candidates, so insertions and ranking changes invalidate readers.
export function createPageModel(ctx, url, title, active, content, options = {}) {
  const {dependencies,...publicOptions}=options;
  const meta=ctx.seo.metadata(url,title,active,publicOptions);
  let value;
  const transforms=[];
  const page={url,title,active,options:publicOptions,meta,
    get content() {
      if (value===undefined) value=ctx.seo.enrich(url,typeof content==='function'?content():content);
      for (const transform of transforms.splice(0)) value=transform(value);
      return value;
    },
    set content(next) {value=next;},
    transformContent(transform) {transforms.push(transform);},
    get cacheKey() {
      return digest([url,title,active,publicOptions,meta,dependencies || page.content,
        dependencies ? null : [ctx.snapshot,ctx.localizationInputs]]);
    }
  };
  return page;
}

import fs from 'node:fs';
import {hash,routeFile} from './incremental.mjs';

// Public Astro 7 prerenderer API. Astro owns template dependency tracking and its cache.
export function incrementalIntegration() {
  return {name:'site-incremental-plan',hooks:{
    'astro:build:start'({setPrerenderer}) {
      const planFile=process.env.SITE_BUILD_PLAN_FILE;
      if (!planFile) return;
      const plan=JSON.parse(fs.readFileSync(planFile,'utf8'));
      const rendered=[];
      setPrerenderer(base=>({
        name:'site-incremental-prerenderer',
        setup:()=>base.setup?.(),
        async getStaticPaths() {
          const paths=await base.getStaticPaths();
          return paths.map(item=>{
            const file=routeFile(item.pathname,item.route), key='/'+file;
            // Static endpoints and informational pages also depend on the exported catalog.
            const model=plan.routes[key] || hash(plan.inputs);
            plan.routes[key]=model;
            return {...item,cacheKey:hash([model,plan.inputs.build,plan.inputs.runtime])};
          });
        },
        async render(request, options) {
          rendered.push('/'+routeFile(new URL(request.url).pathname,options.routeData));
          return base.render(request,options);
        },
        collectStaticImages:base.collectStaticImages?.bind(base),
        async teardown() {
          await base.teardown?.();
          fs.writeFileSync(planFile,JSON.stringify({...plan,rendered},null,2));
        }
      }));
    }
  }};
}

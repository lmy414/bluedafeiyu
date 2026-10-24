# -*- coding: utf-8 -*-
"""生成「密度 v2」可交互原型。

以 frontend/out 的真实构建产物为底：
- 内联打包 CSS，外链 density-v2.css 覆盖层（= 将来落在 CardDensity.css 的改法）
- 图片与链接改指线上绝对地址，保证原型可点、图不缺
- 剥掉外链脚本（统计/国际化/滑块），保持静态可看
- 主页注入「最新作品直达区」（选配项，数据取线上 archive-data.json 前 12 件）
- ?state=current 查看原版对比，默认紧凑版
"""
import json
import re
import urllib.request
from pathlib import Path

ROOT = Path(r'E:\quick-site-studio\bluedafeiyu')
OUT = ROOT / 'frontend' / 'out'
PROTO = ROOT / 'docs' / 'density-mockups' / 'prototype'
LIVE = 'https://xn--pssy23gqgbz2d718b.com'

PROTO.mkdir(parents=True, exist_ok=True)
bundle = (OUT / '_astro' / 'Archive.OQohiG1K.css').read_text(encoding='utf-8')

# 最新作品数据（缓存，避免重复拉线）
cache = PROTO / 'works-cache.json'
if cache.exists():
    works = json.loads(cache.read_text(encoding='utf-8'))[:12]
else:
    req = urllib.request.Request(LIVE + '/archive-data.json', headers={'User-Agent': 'Mozilla/5.0'})
    data = json.load(urllib.request.urlopen(req, timeout=30))
    works = data['works'][:12]
    cache.write_text(json.dumps(works, ensure_ascii=False), encoding='utf-8')

cards = []
for w in works:
    href = f'{LIVE}/works/{w["slug"]}.html'
    img = LIVE + w['i'] if w['i'].startswith('/') else w['i']
    title = w['n']
    cards.append(
        f'<article class="work-card art-card">'
        f'<a class="work-art art-media" style="--ratio:480/480" href="{href}">'
        f'<img src="{img}" alt="" loading="lazy" decoding="async"></a>'
        f'<div class="work-text"><h3 class="work-title"><a href="{href}">{title}</a></h3></div>'
        f'</article>'
    )
latest_strip = (
    '<section class="home-latest" id="homeLatest">'
    '<div class="home-latest-head"><h2>最新作品</h2>'
    f'<a href="{LIVE}/browse.html">全部图片 →</a></div>'
    f'<div class="work-grid">{"".join(cards)}</div></section>'
)

toggle = (
    '<div style="position:fixed;right:14px;bottom:14px;z-index:999;display:flex;gap:0;'
    'border:1px solid #23406b;border-radius:8px;overflow:hidden;background:#fff;'
    'font:12px/1 system-ui, sans-serif;box-shadow:2px 2px 0 rgba(35,64,107,.25)">'
    '<a href="?state=compact" style="padding:8px 12px;color:#23406b;text-decoration:none">紧凑版</a>'
    '<a href="?state=current" style="padding:8px 12px;color:#23406b;text-decoration:none;'
    'border-left:1px solid #23406b">原版对比</a></div>'
    '<script>(function(){var s=new URLSearchParams(location.search).get("state");'
    'if(s==="current"){var c=document.getElementById("densityV2");if(c)c.remove();'
    'var l=document.getElementById("homeLatest");if(l)l.remove();}})();</script>'
)

def transform(name, inject_latest=False):
    html = (OUT / name).read_text(encoding='utf-8')
    # work-stats.js 被剥掉后侧栏计数占位符不会被替换，原型里直接写死
    html = html.replace('__BLUEFISH_WORK_TOTAL__', '1244')
    css_link = re.search(r'<link rel="stylesheet" href="/_astro/[^"]+"[^>]*>', html).group(0)
    html = html.replace(css_link,
        '<style>' + bundle + '</style>\n'
        '<link rel="stylesheet" href="density-v2.css" id="densityV2">')
    # 外链脚本全部剥掉（保留内联主题脚本）
    html = re.sub(r'<script src="[^"]+"></script>', '', html)
    html = re.sub(r'<script[^>]*src="[^"]+"[^>]*></script>', '', html)
    # 根相对地址 → 线上绝对地址（链接与图片原型里都可点）
    html = re.sub(r'(href|src)="/((?!/)[^"]*)"', rf'\1="{LIVE}/\2"', html)
    if inject_latest:
        m = re.search(r'<nav class="portal-primary">.*?</nav>', html, re.S)
        assert m, 'portal-primary not found'
        html = html.replace(m.group(0), m.group(0) + latest_strip)
    html = html.replace('</body>', toggle + '</body>')
    (PROTO / name).write_text(html, encoding='utf-8')
    print('written', name, len(html))

transform('index.html', inject_latest=True)
for name in ['browse.html', 'characters.html', 'videos.html', 'topics.html', 'creators.html',
             'community.html', 'projects.html', 'submit.html', 'about.html', 'changelog.html',
             'search.html', 'category.html', 'saved.html']:
    transform(name)
# 活动页在子目录，拍到原型根下换名
events_src = OUT / 'events' / 'national-day-2026.html'
if events_src.exists():
    html = events_src.read_text(encoding='utf-8')
    html = html.replace('__BLUEFISH_WORK_TOTAL__', '1244')
    css_link = re.search(r'<link rel="stylesheet" href="/_astro/[^"]+"[^>]*>', html).group(0)
    html = html.replace(css_link, '<style>' + bundle + '</style>\n<link rel="stylesheet" href="density-v2.css" id="densityV2">')
    html = re.sub(r'<script src="[^"]+"></script>', '', html)
    html = re.sub(r'<script[^>]*src="[^"]+"[^>]*></script>', '', html)
    html = re.sub(r'(href|src)="/((?!/)[^"]*)"', rf'\1="{LIVE}/\2"', html)
    html = html.replace('</body>', toggle + '</body>')
    (PROTO / 'events-national-day-2026.html').write_text(html, encoding='utf-8')
    print('written events-national-day-2026.html', len(html))

# 覆盖层副本放进原型目录，保证该目录自包含
(PROTO / 'density-v2.css').write_text(
    (ROOT / 'docs' / 'density-mockups' / 'density-v2.css').read_text(encoding='utf-8'),
    encoding='utf-8')
print('done')

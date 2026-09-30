# tools/og_cards.py —— 生成社交分享卡片（1200x630 JPG）
# 用法：python tools/og_cards.py <jobs.json> <缓存目录> <图片根目录> <logo>
#   jobs.json：[{ "id": "w-xxx", "img": "submissions/large/..webp 或 https://…", "title", "sub", "tag", "quote" }]
#   图片根目录：dist/（本地已同步的预览图）；站外原图（首批档案）按网址下载并缓存
# 依赖 Pillow；字体用 OG_FONT_BOLD / OG_FONT_REGULAR 指定（默认 Windows 微软雅黑，Linux 需装 Noto Sans CJK）
# 内容没变的卡片不重画（缓存目录里记 .key）
import hashlib, io, json, os, sys, urllib.parse, urllib.request
from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H = 1200, 630
INK, PAPER, BLUE, GRID = (27, 43, 77), (250, 252, 255), (58, 124, 216), (214, 227, 245)
def pick(env, *cands):
    for p in [os.environ.get(env)] + list(cands):
        if p and os.path.exists(p): return p
    sys.exit('og_cards: 找不到中文字体，请设置 %s' % env)
FONT_B = pick('OG_FONT_BOLD', 'C:/Windows/Fonts/msyhbd.ttc', '/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc', '/usr/share/fonts/noto-cjk/NotoSansCJK-Bold.ttc', '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc')
FONT_R = pick('OG_FONT_REGULAR', 'C:/Windows/Fonts/msyh.ttc', '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc', '/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc', '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc')
font = lambda p, s: ImageFont.truetype(p if os.path.exists(p) else FONT_R, s)

def wrap(draw, text, f, width, lines):
    out, cur = [], ''
    for ch in text:
        if draw.textlength(cur + ch, font=f) > width:
            out.append(cur); cur = ch
            if len(out) == lines: break
        else: cur += ch
    else: out.append(cur)
    out = [l for l in out if l][:lines]
    if len(out) == lines and ''.join(out) != text:
        while draw.textlength(out[-1] + '…', font=f) > width: out[-1] = out[-1][:-1]
        out[-1] += '…'
    return out

ORIGIN = os.environ.get('OG_FALLBACK_ORIGIN', 'https://xn--pssy23gqgbz2d718b.com')

def source(img, base, cache):
    # 本地同步的图片直接读（路径里可能是百分号编码的中文文件名）；
    # 本地缺图（内容仓还没拉到最新）时退回线上同一路径，下载一次后缓存；站外网址同理
    if not img.startswith('http'):
        rel = urllib.parse.unquote(img.lstrip('/'))
        local = os.path.join(base, *rel.split('/'))
        if os.path.exists(local): return local
        img = ORIGIN + '/' + img.lstrip('/')
    dst = os.path.join(cache, 'src', hashlib.sha1(img.encode()).hexdigest()[:16])
    if not os.path.exists(dst):
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        req = urllib.request.Request(img, headers={'User-Agent': 'bluedafeiyu-og/1'})
        with urllib.request.urlopen(req, timeout=60) as r: data = r.read()
        with open(dst + '.tmp', 'wb') as f: f.write(data)
        os.replace(dst + '.tmp', dst)
    return dst

def card(job, src, dst, logo):
    art = Image.open(src).convert('RGB')
    art.thumbnail((1600, 1600))
    im = Image.new('RGB', (W, H), PAPER)
    d = ImageDraw.Draw(im)
    for x in range(0, W, 30): d.line([(x, 0), (x, H)], GRID, 1)
    for y in range(0, H, 30): d.line([(0, y), (W, y)], GRID, 1)
    # 左侧图片区：模糊铺底 + 完整原图，不裁切画面
    bx, by, bw, bh = 40, 40, 640, 550
    bg = art.copy(); bg.thumbnail((bw * 2, bh * 2))
    s = max(bw / bg.width, bh / bg.height)
    bg = bg.resize((int(bg.width * s) + 1, int(bg.height * s) + 1)).filter(ImageFilter.GaussianBlur(24))
    bg = bg.crop(((bg.width - bw) // 2, (bg.height - bh) // 2, (bg.width - bw) // 2 + bw, (bg.height - bh) // 2 + bh))
    d.rounded_rectangle([bx + 8, by + 8, bx + bw + 8, by + bh + 8], 18, INK)
    mask = Image.new('L', (bw, bh), 0); ImageDraw.Draw(mask).rounded_rectangle([0, 0, bw - 1, bh - 1], 18, 255)
    im.paste(bg, (bx, by), mask)
    fg = art.copy(); fg.thumbnail((bw - 28, bh - 28), Image.LANCZOS)
    im.paste(fg, (bx + (bw - fg.width) // 2, by + (bh - fg.height) // 2))
    d.rounded_rectangle([bx, by, bx + bw, by + bh], 18, outline=INK, width=4)
    # 右侧文字
    x, tw = 720, 440
    y = 56
    if job.get('tag'):
        f = font(FONT_B, 26); t = job['tag']; w = d.textlength(t, font=f)
        d.rounded_rectangle([x, y, x + w + 36, y + 48], 12, BLUE, INK, 3); d.text((x + 18, y + 7), t, (255, 255, 255), font=f)
        y += 68
    # 标题：长标题自动缩小字号
    for size, lines in ((50, 2), (42, 2), (36, 3)):
        f = font(FONT_B, size); tl = wrap(d, job['title'], f, tw, lines)
        if ''.join(tl) == job['title'] or size == 36: break
    for line in tl: d.text((x, y), line, INK, font=f); y += int(size * 1.3)
    y += 18
    sub = job.get('sub', '')
    if job.get('quote') and sub:
        # 大肥鱼点评：便签气泡 + 引号，最多 5 行
        f = font(FONT_R, 27); room = (H - 150 - y - 36) // 40
        lines = wrap(d, sub, f, tw - 44, max(2, min(5, room)))
        bh2 = len(lines) * 40 + 36
        d.rounded_rectangle([x + 6, y + 6, x + tw + 6, y + bh2 + 6], 14, INK)
        d.rounded_rectangle([x, y, x + tw, y + bh2], 14, (232, 241, 255), INK, 3)
        d.polygon([(x + 34, y + bh2 - 1), (x + 62, y + bh2 - 1), (x + 30, y + bh2 + 24)], (232, 241, 255), INK)
        d.line([(x + 36, y + bh2 - 1), (x + 60, y + bh2 - 1)], (232, 241, 255), 4)
        d.text((x + 14, y - 8), '“', BLUE, font=font(FONT_B, 54))
        ty = y + 18
        for line in lines: d.text((x + 30, ty), line, INK, font=f); ty += 40
    else:
        f = font(FONT_R, 27)
        for line in wrap(d, sub, f, tw, 3): d.text((x, y), line, (74, 92, 128), font=f); y += 40
    # 底部站点标识
    lg = logo.copy(); lg.thumbnail((56, 56)); im.paste(lg, (x, H - 104), lg)
    d.text((x + 70, H - 106), '蓝色大肥鱼', INK, font=font(FONT_B, 30))
    d.text((x + 70, H - 68), 'AI 娘二创图库', (74, 92, 128), font=font(FONT_R, 22))
    im.save(dst, 'JPEG', quality=86, optimize=True, progressive=True)

if __name__ == '__main__':
    jobs = json.load(open(sys.argv[1], encoding='utf-8')); out, base, logo_path = sys.argv[2], sys.argv[3], sys.argv[4]
    os.makedirs(out, exist_ok=True)
    logo = Image.open(logo_path).convert('RGBA')
    made, failed = 0, []
    for j in jobs:
        dst = os.path.join(out, j['id'] + '.jpg')
        key = json.dumps(j, ensure_ascii=False, sort_keys=True)
        stamp = os.path.join(out, j['id'] + '.key')
        try:
            src = source(j['img'], base, out)
            if os.path.exists(dst) and os.path.exists(stamp) and open(stamp, encoding='utf-8').read() == key and os.path.getmtime(dst) >= os.path.getmtime(src):
                continue   # 内容没变就不重画
            card(j, src, dst + '.tmp', logo); os.replace(dst + '.tmp', dst)
            open(stamp, 'w', encoding='utf-8').write(key); made += 1
        except Exception as e:
            failed.append('%s: %s' % (j['id'], e))
    print('分享卡片：共 %d 张，本次生成 %d 张%s' % (len(jobs), made, '，失败 %d 张' % len(failed) if failed else ''))
    for f in failed[:20]: print('  ' + f)
    sys.exit(1 if failed else 0)

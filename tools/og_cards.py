# tools/og_cards.py —— 生成社交分享卡片（1200x630 JPG）
# 用法：python tools/og_cards.py <jobs.json> <缓存目录> <图片根目录> <logo>
#   jobs.json：[{ "id": "w-xxx", "img": "submissions/large/..webp 或 https://…", "title", "sub", "tag", "quote" }]
#   图片根目录：dist/（本地已同步的预览图）；本地缺图直接失败，站外 URL 才下载并缓存
# 依赖 Pillow；占位 SVG 由本脚本光栅化；字体用 OG_FONT_BOLD / OG_FONT_REGULAR 指定
# 内容没变的卡片不重画（缓存目录里记 .key）
import hashlib, io, json, os, re, sys, urllib.parse, urllib.request
import xml.etree.ElementTree as ET
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

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PLACEHOLDER_SVG = os.path.join(ROOT, 'frontend', 'public', 'components', 'image-placeholder.svg')

def is_placeholder(img):
    return os.path.basename(urllib.parse.urlsplit(img).path) == 'image-placeholder.svg'

def download(img, cache):
    dst = os.path.join(cache, 'src', hashlib.sha1(img.encode()).hexdigest()[:16])
    if not os.path.exists(dst):
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        req = urllib.request.Request(img, headers={'User-Agent': 'bluedafeiyu-og/1'})
        with urllib.request.urlopen(req, timeout=60) as r: data = r.read()
        with open(dst + '.tmp', 'wb') as f: f.write(data)
        os.replace(dst + '.tmp', dst)
    return dst

def source(img, base, cache):
    # 本地同步的图片直接读（路径里可能是百分号编码的中文文件名）。
    # 本地缺图就是构建问题，直接失败；不再悄悄下载线上同名文件来掩盖失配。
    if not img:
        raise ValueError('分享卡片没有图片来源')
    if is_placeholder(img):
        if not os.path.isfile(PLACEHOLDER_SVG):
            raise FileNotFoundError('占位图不存在：%s' % PLACEHOLDER_SVG)
        return PLACEHOLDER_SVG
    if img.lower().startswith('http'):
        return download(img, cache)
    rel = urllib.parse.unquote(img.lstrip('/'))
    local = os.path.join(base, *rel.split('/'))
    if not os.path.isfile(local):
        raise FileNotFoundError('本地分享卡片图片不存在：%s（不再回退线上同名地址）' % local)
    return local

def svg_number(value, default=0.0):
    return float(value) if value not in (None, '') else default

def svg_color(value):
    if value is None or value == 'none': return None
    value = value.strip()
    if value.startswith('#'):
        raw = value[1:]
        if len(raw) == 3: raw = ''.join(ch * 2 for ch in raw)
        if len(raw) == 6: return tuple(int(raw[i:i + 2], 16) for i in (0, 2, 4))
    raise ValueError('占位 SVG 含有不支持的填充/描边颜色：' + value)

def svg_path_segments(d):
    tokens = re.findall(r'[A-Za-z]|-?(?:\d+\.\d*|\.\d+|\d+)(?:[eE][-+]?\d+)?', d)
    segments, points, x, y, start = [], [], 0.0, 0.0, (0.0, 0.0)
    cmd, i = None, 0
    def number():
        nonlocal i
        value = float(tokens[i]); i += 1
        return value
    while i < len(tokens):
        if tokens[i].isalpha():
            cmd = tokens[i]; i += 1
            if cmd in 'Zz':
                if points: points.append(points[0]); segments.append(points)
                points, x, y = [], start[0], start[1]
                cmd = None
            continue
        if cmd is None: raise ValueError('占位 SVG 路径缺少指令')
        if cmd in 'Mm':
            px, py = number(), number()
            x, y = (px, py) if cmd == 'M' else (x + px, y + py)
            if points: segments.append(points)
            points, start = [(x, y)], (x, y)
            cmd = 'L' if cmd == 'M' else 'l'
        elif cmd in 'Ll':
            px, py = number(), number()
            x, y = (px, py) if cmd == 'L' else (x + px, y + py)
            points.append((x, y))
        elif cmd in 'Hh':
            px = number(); x = px if cmd == 'H' else x + px
            points.append((x, y))
        elif cmd in 'Vv':
            py = number(); y = py if cmd == 'V' else y + py
            points.append((x, y))
        else:
            raise ValueError('占位 SVG 路径含有不支持的指令：' + cmd)
    if points: segments.append(points)
    return segments

def render_placeholder_svg(path):
    # 只光栅化 frontend/public/components/image-placeholder.svg 用到的图形子集
    # （rect / circle / path）。遇到其它元素或颜色直接报错，不静默输出空图。
    root = ET.parse(path).getroot()
    width, height = round(svg_number(root.get('width'))), round(svg_number(root.get('height')))
    if width <= 0 or height <= 0: raise ValueError('占位 SVG 缺少有效宽高：' + path)
    image = Image.new('RGB', (width, height), (255, 255, 255))
    draw = ImageDraw.Draw(image)
    def walk(node, inherited):
        tag = node.tag.rsplit('}', 1)[-1]
        style = dict(inherited); style.update(node.attrib)
        fill = svg_color(style.get('fill', '#000000'))
        stroke = svg_color(style.get('stroke', 'none'))
        stroke_width = max(1, round(svg_number(style.get('stroke-width'), 1)))
        if tag in ('svg', 'g'):
            for child in node: walk(child, style)
        elif tag == 'rect':
            x, y = svg_number(style.get('x')), svg_number(style.get('y'))
            w, h = svg_number(style.get('width')), svg_number(style.get('height'))
            radius = svg_number(style.get('rx'))
            box = [x, y, x + w, y + h]
            extra = {'outline': stroke, 'width': stroke_width} if stroke is not None else {}
            if radius: draw.rounded_rectangle(box, radius=radius, fill=fill, **extra)
            else: draw.rectangle(box, fill=fill, **extra)
        elif tag == 'circle':
            cx, cy, r = svg_number(style.get('cx')), svg_number(style.get('cy')), svg_number(style.get('r'))
            box = [cx - r, cy - r, cx + r, cy + r]
            extra = {'outline': stroke, 'width': stroke_width} if stroke is not None else {}
            draw.ellipse(box, fill=fill, **extra)
        elif tag == 'path':
            joint = 'curve' if style.get('stroke-linejoin') == 'round' else None
            for points in svg_path_segments(style.get('d', '')):
                if fill is not None and len(points) > 2: draw.polygon(points, fill=fill)
                if stroke is not None:
                    draw.line(points, fill=stroke, width=stroke_width, joint=joint)
                    if style.get('stroke-linecap') == 'round':
                        for cx, cy in (points[0], points[-1]):
                            draw.ellipse([cx - stroke_width / 2, cy - stroke_width / 2, cx + stroke_width / 2, cy + stroke_width / 2], fill=stroke)
        else:
            raise ValueError('占位 SVG 含有不支持的图形元素：' + tag)
    walk(root, {})
    return image

def load_art(src):
    if src.lower().endswith('.svg'):
        if not is_placeholder(src): raise ValueError('分享卡片只支持占位 SVG 转位图：' + src)
        return render_placeholder_svg(src)
    return Image.open(src).convert('RGB')

def card(job, src, dst, logo):
    art = load_art(src)
    im = Image.new('RGB', (W, H), PAPER)
    d = ImageDraw.Draw(im)
    for x in range(0, W, 30): d.line([(x, 0), (x, H)], GRID, 1)
    for y in range(0, H, 30): d.line([(0, y), (W, y)], GRID, 1)
    # 左侧图片区：模糊铺底 + 完整原图，不裁切画面。占位 SVG 已转成位图，不会留空框。
    bx, by, bw, bh = 40, 40, 640, 550
    art.thumbnail((1600, 1600))
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
    d.text((x + 70, H - 42), '访问：蓝色大肥鱼.com', BLUE, font=font(FONT_B, 24))
    im.save(dst, 'JPEG', quality=86, optimize=True, progressive=True)

if __name__ == '__main__':
    jobs = json.load(open(sys.argv[1], encoding='utf-8')); out, base, logo_path = sys.argv[2], sys.argv[3], sys.argv[4]
    os.makedirs(out, exist_ok=True)
    logo = Image.open(logo_path).convert('RGBA')
    # File contents, renderer and fonts determine the cache, not copied mtimes.
    def digest_file(filename):
        with open(filename, 'rb') as stream:
            return hashlib.sha256(stream.read()).hexdigest()
    renderer_key = [digest_file(__file__), digest_file(logo_path), digest_file(FONT_B), digest_file(FONT_R)]
    made, failed = 0, []
    for j in jobs:
        dst = os.path.join(out, j['id'] + '.jpg')
        stamp = os.path.join(out, j['id'] + '.key')
        try:
            # Real image errors fail the card and the build. The only SVG we
            # rasterize is the explicit shared placeholder, so a small number
            # of missing works still gets a real card image instead of an empty frame.
            src = source(j.get('img') or '', base, out)
            key = json.dumps([j, renderer_key, digest_file(src)], ensure_ascii=False, sort_keys=True)
            if os.path.exists(dst) and os.path.exists(stamp) and open(stamp, encoding='utf-8').read() == key:
                continue   # 内容没变就不重画
            card(j, src, dst + '.tmp', logo); os.replace(dst + '.tmp', dst)
            open(stamp, 'w', encoding='utf-8').write(key); made += 1
        except Exception as e:
            failed.append('%s: %s' % (j['id'], e))
    print('分享卡片：共 %d 张，本次生成 %d 张%s' % (len(jobs), made, '，失败 %d 张' % len(failed) if failed else ''))
    for f in failed: print('  [失败] ' + f)
    sys.exit(1 if failed else 0)

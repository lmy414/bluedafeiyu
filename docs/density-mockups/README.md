# 密度优化 · 基线截图与可交互原型

配套方案：`docs/前端信息密度优化方案.md`（2026-10-24 二稿：全站一级页面，待确认）。

## 文件

- `baseline-*.png` — 线上现状基线（1440 宽，headless Chrome 实拍；主页另有 732 折叠与 1937 整页两张）
- `prototype-*.png` — 紧凑版效果（真实构建产物 + `density-v2.css` 覆盖层），覆盖 13 个一级页面
- `density-v2.css` — 覆盖层即未来 `CardDensity.css` v2 的内容（分区注释 A–Q 对应方案文档分项）
- `prototype/` — 自包含原型站，**15 个一级页面**全覆盖，图片与链接指向线上站
- `build_prototype.py` — 重新生成原型：`python build_prototype.py`（需先有 `frontend/out` 构建）

## 本地查看

```bash
cd docs/density-mockups && python -m http.server 4477 --bind 127.0.0.1
# 打开 http://127.0.0.1:4477/prototype/index.html
# ?state=current 为原版对比（同 DOM 口径）；默认紧凑版
```

原型局限：语言切换、自定义下拉、滑块翻页、表单增强脚本被剥离——submit/search 等页的"原版"比线上偏高（区块未折叠），对比以同 DOM 口径为准；不影响几何评估。

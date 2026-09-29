<div align="center">
  <img src="https://raw.githubusercontent.com/lmy414/ai-girl-stickers/main/dist/avatar.png" width="112" alt="Blue Big Fish サイトアイコン">
  <h1>Blue Big Fish</h1>
  <p><strong>AI 娘の二次創作スタンプを集めたオープンアーカイブ</strong></p>
  <p>
    <a href="https://xn--pssy23gqgbz2d718b.com/"><img src="https://img.shields.io/website?url=https%3A%2F%2Fxn--pssy23gqgbz2d718b.com%2F&style=for-the-badge&label=site&up_message=online&down_message=offline" alt="サイトのオンライン状態"></a>
    <a href="frontend/"><img src="https://img.shields.io/badge/frontend-Astro%20static-BC52EE?style=for-the-badge&logo=astro&logoColor=white" alt="Astro の静的フロントエンド"></a>
    <a href="package.json"><img src="https://img.shields.io/badge/Node.js-22.12%2B-339933?style=for-the-badge&logo=nodedotjs&logoColor=white" alt="Node.js 22.12 以降が必要"></a>
    <a href="LICENSE"><img src="https://img.shields.io/badge/code%20license-MIT-2ea44f?style=for-the-badge" alt="コードは MIT ライセンス"></a>
  </p>
  <p>
    <a href="README.md">简体中文</a> ·
    <a href="README.en.md">English</a> ·
    <strong>日本語</strong>
  </p>
</div>

---

Blue Big Fish は、AI 娘の二次創作スタンプを集めたオープンアーカイブです。ミーム、イラスト、設定資料、漫画をキャラクターごとに整理しています。名前、タグ、キャラクターの別名で検索できます。各作品には個別ページがあり、出典とライセンスを確認して原画をダウンロードできます。

UI は中国語、英語、日本語に対応しています。

## プロジェクト概要

| 項目 | 内容 |
| --- | --- |
| フロントエンド | Astro で構築した静的サイト |
| UI 言語 | 中国語、英語、日本語 |
| 作品種別 | ミーム、イラスト、設定資料、漫画 |
| 画像 | 独立した公開画像アーカイブに保存 |
| 投稿方法 | サイト内フォーム、QQ グループ Bot、GitHub Issue フォーム |

## 主なリンク

| 用途 | リンク |
| --- | --- |
| オンラインで閲覧 | <https://xn--pssy23gqgbz2d718b.com/> |
| サイト内投稿 | <https://xn--pssy23gqgbz2d718b.com/submit.html> |
| QQ グループ投稿 | 投稿グループで Bot を @ し、「投稿 标题 角色」と画像を同じメッセージで送信 |
| GitHub Issue 投稿 | <https://github.com/lmy414/ai-girl-stickers/issues/new?template=sticker-submission.yml> |
| クレジット修正・削除依頼 | <https://github.com/lmy414/ai-girl-stickers/issues/new?template=takedown-request.yml> |
| 画像アーカイブ | <https://github.com/lmy414/ai-girl-stickers> |

## リポジトリの役割

| リポジトリ | 役割 |
| --- | --- |
| `bluedafeiyu`（このリポジトリ） | Astro フロントエンド、構造化データ、ビルドスクリプト、投稿サービス、公開ツール |
| `ai-girl-stickers` | 投稿原画、派生画像、サイト画像素材、投稿・削除依頼フォーム |

このリポジトリでページを生成し、画像アーカイブで画像を保存します。ここでは画像ファイルを管理しません。ビルド時に画像アーカイブから同期します。

## システム構成

以下の 3 つの図はコンポーネントと処理の流れだけを示し、本番ホスト、ポート、秘密情報は含みません。

### サイト構成

```mermaid
flowchart LR
  subgraph 訪問者
    V[ブラウザ]
    Q[QQ 投稿グループ]
    G[GitHub Issue フォーム]
  end
  subgraph エッジ
    CF[Cloudflare CDN<br/>Turnstile]
  end
  subgraph サーバー
    NG[Nginx]
    ST[静的サイト<br/>Astro ビルド成果物]
    SUB[統合投稿サービス<br/>server/]
    ADM[管理画面<br/>Payload CMS]
    PUB[公開ワーカー<br/>ops/admin/]
    HM[Hermes Agent<br/>AI 審査・定期実行・QQ プラグイン]
  end
  subgraph GitHub
    SR[(サイトリポジトリ<br/>bluedafeiyu)]
    CR[(画像リポジトリ<br/>ai-girl-stickers)]
  end
  FS[Feishu グループ通知]

  V --> CF --> NG
  NG --> ST
  NG -->|"/api 投稿"| SUB
  NG -->|"管理画面"| ADM
  Q --> HM -->|"QQ 受信"| SUB
  G -.->|定期的に添付を取得| SUB
  HM -->|"審査結果を書き戻し"| SUB
  SUB -->|"公開待ちへ同期"| ADM
  ADM -->|"公開リクエスト"| PUB
  PUB -->|"マニフェストをコミット"| SR
  PUB -->|"原画像と派生画像をコミット"| CR
  PUB -->|"ビルドとデプロイ"| ST
  V -.->|原画像のダウンロード| CR
  SUB & PUB & HM --> FS
```

### データ処理の流れ

```mermaid
flowchart TD
  A1[サイト<br/>Turnstile + IP ごとに 1 時間 10 回] --> C
  A2[QQ グループ<br/>@ボット + 1 時間 10 枚] --> C
  A3[GitHub Issue<br/>ラベル絞り込み + 添付の許可リスト] --> C
  C[sha256 で重複排除してキューへ<br/>状態 received] --> D[Hermes AI 審査]
  D -->|"通過"| E[auto_passed<br/>名前・タグ・分類・本文を生成]
  D -->|"却下"| F[auto_rejected<br/>理由を記録]
  D -->|"判断保留"| M[needs_manual]
  M --> H[管理画面で手動審査]
  F --> H
  E --> I[管理画面の公開待ち]
  H -->|"手動で収録"| I
  I --> J[公開ワーカー]
  J --> K[原画像の書き込み・派生画像の生成・works.json の更新]
  K --> L[ビルド検証 → 両リポジトリへ push → デプロイ]
  L --> N[サーバー上の原画像を解放<br/>ダウンロードは GitHub Raw へ]
  L --> O[公開結果の通知]
```

### 同期の流れ

```mermaid
sequenceDiagram
  autonumber
  participant GH as GitHub Issue
  participant HM as Hermes 定期実行
  participant SUB as 投稿サービス
  participant ADM as 管理画面
  participant PUB as 公開ワーカー
  participant REPO as サイト / 画像リポジトリ
  participant FS as Feishu グループ

  HM->>SUB: 1 日 3 回 Issue の添付を取得
  SUB-->>FS: 投稿を受信
  loop 5 分ごと
    HM->>SUB: 審査待ちを取得して審査結果を書き戻し
    SUB-->>FS: 審査結果
    HM->>ADM: 投稿を公開待ちへ同期
    HM->>GH: 照合：公開済み → 作品リンクを返信して閉じる<br/>却下 → 理由（AI / 手動審査）を書いて閉じる
    HM-->>FS: Issue に返信して閉じた
  end
  loop 6 時間ごと
    HM->>ADM: 同期してから公開計画を取得
    ADM->>PUB: 変更があれば公開を開始
    PUB->>REPO: コミット・push・ビルド・デプロイ
    PUB->>SUB: push 済みの原画像を解放
    PUB-->>FS: 公開成功 / 失敗
  end
  ADM->>GH: 管理画面から素早く返信して閉じる（オーナーが手動）
```
## ディレクトリ構成

| パス | 内容 |
| --- | --- |
| `frontend/` | Astro のソース。ページは `src/pages/`、レイアウトとコンポーネントは `src/layouts/` と `src/components/`、公開アセットは `public/` |
| `data/` | キャラクター、カテゴリ、作品、サイト運営者のおすすめ、特集、編集用オーバーレイの正本 JSON |
| `tools/` | ビルド、コンテンツ同期、データ一時展開、スナップショット生成、画像派生、静的圧縮スクリプト |
| `server/` | Web、QQ グループ、GitHub Issue を統合する投稿サービス。本番稼働中 |
| `tools/intake/` | 管理者向けの取込ツール。重複確認、一時保管、GitHub Issue 添付の取込を担当 |
| `ops/` | デプロイ、ロールバック、審査・公開自動化、サーバー設定例 |
| `docs/` | 通信高速化、CDN、投稿自動化、Hermes 審査などの保守資料 |
| `archive/` | リポジトリ分割前の履歴資料 |
| `dist/`、`.build/`、`frontend/out/` | ビルド時またはローカル実行時の生成物。フロントエンドのソースではありません |

詳しい使い方は [`server/README.md`](server/README.md) と [`tools/intake/README.md`](tools/intake/README.md) を参照してください。一般投稿はサイト内フォーム、QQ グループ Bot、画像アーカイブの GitHub Issue フォームから受け付けます。

## ブランド素材

README のヘッダーでは、画像アーカイブの `dist/avatar.png` を使用しています。主な素材は次のとおりです。

| ファイル | サイズ | 用途 |
| --- | --- | --- |
| [`dist/avatar.png`](https://github.com/lmy414/ai-girl-stickers/blob/main/dist/avatar.png) | 96 × 96 | サイトのアバターと README ロゴ |
| [`dist/favicon.ico`](https://github.com/lmy414/ai-girl-stickers/blob/main/dist/favicon.ico) | 256 × 256 | ブラウザータブのアイコン |
| [`dist/favicon.png`](https://github.com/lmy414/ai-girl-stickers/blob/main/dist/favicon.png) | 512 × 512 | 高解像度のサイトアイコン |
| [`dist/qq-group.png`](https://github.com/lmy414/ai-girl-stickers/blob/main/dist/qq-group.png) | 518 × 518 | QQ グループの QR コード |

## ローカルプレビュー

サイトの閲覧だけならローカル環境は不要です。フロントエンドを変更する場合やビルドを確認する場合は、Node.js 22.12 以降と画像アーカイブのクローンを用意します。

```powershell
cd frontend
npm ci
cd ..
node tools/build_site.mjs --content-dir <画像アーカイブのパス> --out .build/site
python -m http.server 5173 -d .build/site
```

ビルド結果は `.build/site/` に出力されます。フロントエンドの詳細は [`frontend/README.md`](frontend/README.md)、デプロイとサーバー設定は [`docs/`](docs/) を参照してください。

## 投稿と著作権

これは非公式の同人アーカイブです。投稿はサイト内フォーム、QQ グループ Bot、画像アーカイブの GitHub Issue フォームから受け付けます。クレジット修正と削除依頼は引き続き GitHub Issue フォームを使用します。詳しいルールは [`CONTRIBUTING.md`](https://github.com/lmy414/ai-girl-stickers/blob/main/CONTRIBUTING.md) を参照してください。

画像の著作権は常に原作者に帰属します。このリポジトリで公開されたことやサイトに掲載されたことによって、画像に MIT ライセンスが自動的に付与されることはありません。再利用する前に、各作品の個別ページに記載された出典とライセンスを確認してください。このリポジトリのコードは MIT ライセンスで公開しています。詳細は [`LICENSE`](LICENSE) を参照してください。

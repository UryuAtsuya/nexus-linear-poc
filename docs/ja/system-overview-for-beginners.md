# システム全体構造の解説（初学者向け）

このドキュメントでは、このプロジェクト全体がどのような仕組みで動いているかを、
プログラミング初心者の方にも伝わるよう、できるだけ平易な言葉で説明します。

---

## このシステムは何をするもの？

一言でいうと、**「Linear のタスクを受け取り、Claude（AI）がコードを書いて、GitHub にプルリクエストを自動で出すシステム」**です。

```
Linear（タスク管理）
    ↓
Orchestrator（司令塔）
    ↓
Claude Runner（AIがコードを書く）
    ↓
GitHub（プルリクエストを作成）
    ↓
Linear（結果を報告）
```

人間がやることは「Linear にタスクを作る」と「GitHub の PR をレビューして承認（マージ）する」だけです。
その間の作業（コードを書いて PR を出す部分）を AI が自動で行います。

---

## 登場するコンポーネントの紹介

システムはいくつかの「部品（パッケージ）」に分かれています。それぞれの役割を見ていきましょう。

---

### Orchestrator（オーケストレーター）— 司令塔

**場所**: `apps/orchestrator/src/index.js`

全体の処理を管理・制御する中心的な存在です。
音楽でいう「指揮者」のような役割で、他のすべての部品に指示を出します。

**主な仕事**:
1. Linear からタスク（イシュー）の情報を取得する
2. そのタスクが AI による自動実行の対象かどうかを判断する
3. Claude（AI）を呼び出してコードを書かせる
4. 書かれたコードを GitHub にプルリクエストとして送る
5. 実行結果を Linear に報告する

---

### Linear Client（リニアークライアント）— Linear との窓口

**場所**: `packages/linear-client/src/index.js`

Linear というタスク管理ツールとやり取りするための部品です。

**主な仕事**:
- タスク（イシュー）の内容を Linear から取得する
- AI の実行結果（成功・失敗など）を Linear のコメントとして投稿する

**2 つの動作モード**:
- **fixture モード**: 開発・テスト用。実際の Linear にはアクセスせず、手元の JSON ファイルからデータを読む
- **api モード**: 本番用。実際の Linear API にネットワーク経由でアクセスする

---

### Policy Engine（ポリシーエンジン）— ルール番人

**場所**: `packages/policy-engine/src/index.js`

「このタスクを AI が自動実行してよいか？」を判断するための部品です。
安全に運用するための「門番」の役割を果たします。

**チェック内容（すべて通過して初めて実行が許可される）**:
1. タスクに `ai-ready` ラベルが付いているか
2. タスクに `do-not-automate`・`high-risk` などの禁止ラベルが付いていないか
3. タスクの優先度が `low`（低）または `medium`（中）か
4. タスクの状態が `backlog`・`todo`・`triage`・`in-progress` のいずれかか
5. オントロジー（ドメイン知識）の観点で、人間のレビューが不要か

ひとつでもチェックを通過しなければ、AI による実行はブロックされます。

---

### Claude Runner（クロードランナー）— AIの実行担当

**場所**: `packages/claude-runner/src/index.js`

Claude（Anthropic の AI）にコードを書いてもらうための部品です。
タスクの内容や制約条件を整理して Claude に伝え、出力を受け取ります。

**2 つの動作モード**:
- **stub モード**: 開発・テスト用。実際の Claude は呼び出さず、ダミーの出力を返す
- **cli モード**: 本番用。Claude Code CLI を実際に起動して処理させる

---

### GitHub Client（ギットハブクライアント）— GitHubとの窓口

**場所**: `packages/github-client/src/index.js`

GitHub というソースコード管理サービスとやり取りするための部品です。

**主な仕事**:
- Claude が書いたコード変更をもとに、プルリクエスト（PR）を作成する
- PR の URL を取得して Orchestrator に返す

**3 つの動作モード**:
- **draft-only モード**: 実際の GitHub には送らず、PR の内容だけをローカルに生成する
- **local-commit モード**: ローカルリポジトリにコミットするが、push はしない
- **api モード**: 実際に GitHub API を通じて PR を作成する

---

### Ontology Loader（オントロジーローダー）— 知識の参照係

**場所**: `packages/ontology-loader/src/index.js`

「このタスクはシステムのどの領域に関係するか」「リスクはどのくらいか」を分類する部品です。

**主な仕事**:
- ドメインモデル JSON を読み込む
- タスクの内容に基づいてリスクレベルとエリアを判定する
- ポリシーエンジンに判断材料を渡す

---

### Runner Manager（ランナーマネージャー）— 作業場の管理係

**場所**: `packages/runner-manager/src/index.js`

AI がコードを書くための「専用の作業場所」を準備・管理する部品です。

**主な仕事**:
- タスクごとに独立した作業ディレクトリ（`/tmp/nexus-linear-poc-runs/<run-id>/`）を作る
- git の worktree を作成し、メインブランチとは切り離された環境を用意する
- 実行が終わったら作業場所を片付ける

---

## データの流れ（詳細）

実際にタスクが処理される順番を追ってみましょう。

```
[1] Linear からイシューを取得
      ↓ issueId, title, description, labels, priority, state ...

[2] Ontology でイシューを分類
      ↓ primaryArea, overallRisk, relatedFiles ...

[3] Policy でイシューを評価
      ↓ allowed: true / false

    ✗ false → "blocked" を返して終了（Linear に報告）
    ✓ true  → 次へ

[4] Runner Manager で作業環境を準備
      ↓ runId, branchName, worktreePath ...

[5] Execution Context を構築
      ↓ タスク情報＋オントロジー＋ポリシー情報をまとめたオブジェクト

[6] Claude Runner を実行
      ↓ suggestedChanges, summary, prompts ...

[7] GitHub Client で出力を準備
      ↓ PR タイトル、本文、差分情報 ...

[8] GitHub に公開
      ↓ pullRequest.url ...

[9] Linear にコメントを投稿（オプション）

[10] 成果物をファイルに保存
      execution-context.json
      ontology-context.json
      claude-input.md
      github-pr-draft.md
      run-summary.json
```

---

## モードの組み合わせ（開発 vs 本番）

各部品は「モード」を切り替えることで、実際の外部サービスを使わずに動作確認できます。

| 部品 | 開発・テスト用モード | 本番用モード |
|---|---|---|
| Linear Client | `fixture`（JSON ファイル読み込み） | `api`（Linear API） |
| Claude Runner | `stub`（ダミー出力） | `cli`（Claude Code CLI） |
| GitHub Client | `draft-only`（ローカル生成のみ） | `api`（GitHub API） |

開発中はすべてをローカルモードにしておくと、外部サービスへの接続なしに一通りの流れを確認できます。

---

## セキュリティ設計の考え方

このシステムは「AI が勝手に本番コードを変更する」のを防ぐために、いくつかの安全装置を持っています。

1. **ラベルによるオプトイン** — タスクに `ai-ready` ラベルが付いていないと動かない
2. **優先度・状態の制限** — 高優先度や特定の状態のタスクは対象外
3. **ブランチ分離** — AI の変更は必ず独立したブランチで行われ、メインブランチには直接触れない
4. **人間によるマージ** — PR を実際にマージするのは必ず人間
5. **ブロックラベル** — `high-risk` や `do-not-automate` ラベルがあれば即座に停止

---

## ファイル構成のまとめ

```
nexus-linear-poc/
├── apps/
│   └── orchestrator/          # 司令塔
│       └── src/index.js
├── packages/
│   ├── linear-client/         # Linear との窓口
│   ├── github-client/         # GitHub との窓口
│   ├── claude-runner/         # Claude（AI）の実行担当
│   ├── policy-engine/         # 実行可否の判断
│   ├── ontology-loader/       # リスク・エリア分類
│   └── runner-manager/        # 作業環境の管理
├── ontology/
│   └── domain-model.json      # ドメイン知識の定義ファイル
├── tests/
│   └── fixtures/              # テスト用のダミーデータ
└── docs/
    ├── architecture/          # アーキテクチャ設計ドキュメント
    └── ja/                    # 日本語ドキュメント（このフォルダ）
```

---

## まとめ

このシステムの流れを一言で表すと:

> **「Linear のタスクを受け取り、安全かどうかを確認してから、Claude（AI）にコードを書かせて、GitHub にプルリクエストを出し、結果を Linear に報告する」**

各部品は役割が明確に分かれており、モードを切り替えるだけでテスト環境から本番環境まで段階的に動作確認できるよう設計されています。

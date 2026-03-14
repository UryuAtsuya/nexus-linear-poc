# nexus-linear-poc

Linear issue を入口にして、Claude Code が isolated branch で修正し、GitHub PR を返す流れを検証する PoC。

「チケットを AI に安全に渡して、別ブランチで修正させ、人間が最後にレビューしてマージする」自動化基盤の実証。

## アーキテクチャ

```
Linear (UI)
  │  ai-ready ラベルを付ける
  ▼
webhook-gateway        ← POST /webhook/linear
  │  HMAC 検証 → 即 200 → 非同期キック
  ▼
orchestrator
  ├─ linear-client     ← issue 取得 (fixture / API)
  ├─ ontology-loader   ← ドメイン領域 / リスク判定
  ├─ policy-engine     ← 実行可否チェック (blocked なら止まる)
  ├─ runner-manager    ← git worktree / scaffold 作成
  ├─ claude-runner     ← Claude Code CLI 呼び出し (stub / cli)
  └─ github-client     ← PR draft / local commit / API (draft-only / local-commit / api)
  │
  ▼
Linear issue comment  ← 結果を返す
GitHub Pull Request   ← コード変更
```

merge は必ず人間がやる前提。対象は低リスク task のみ。

## ドキュメント

- [docs/requirements/poc-v1.md](./docs/requirements/poc-v1.md)
- [docs/architecture/system-overview.md](./docs/architecture/system-overview.md)
- [docs/architecture/sequence-linear-to-pr.md](./docs/architecture/sequence-linear-to-pr.md)
- [docs/decisions/adr-001-runtime.md](./docs/decisions/adr-001-runtime.md)
- [ontology/README.md](./ontology/README.md)

## セットアップ

```bash
cp .env.example .env
# .env に必要な値を記入
pnpm install   # または npm install
```

### 環境変数

| 変数 | 説明 |
|---|---|
| `LINEAR_API_KEY` | Linear GraphQL API キー |
| `LINEAR_WEBHOOK_SECRET` | webhook 署名検証用シークレット |
| `LINEAR_TEAM_KEY` | Linear チームキー |
| `GITHUB_TOKEN` | GitHub Personal Access Token |
| `GITHUB_OWNER` | リポジトリオーナー (org or user) |
| `GITHUB_REPO` | リポジトリ名 |
| `ANTHROPIC_API_KEY` | Anthropic API キー |
| `CLAUDE_CODE_COMMAND` | claude CLI のパス (default: `claude`) |
| `CLAUDE_CODE_MODEL` | モデル指定 (例: `claude-sonnet-4-6`) |
| `PORT` | webhook サーバーのポート (default: `3000`) |
| `CLAUDE_MODE` | `stub` or `cli` (default: `stub`) |
| `GITHUB_MODE` | `draft-only` / `local-commit` / `api` (default: `draft-only`) |
| `NOTIFY_LINEAR` | Linear に結果コメントを返すか (default: `false`) |

## 使い方

### 1. PoC をローカルで動かす (API 不要)

fixture issue + stub runner で全体フローを確認：

```bash
pnpm prototype
# または
node scripts/run-prototype.mjs --quiet
```

### 2. Claude Code CLI で実際に実行する

> **注意**: `--claude-mode cli` は **Claude Code セッション外のターミナル**から実行してください。
> Claude Code 内から呼ぶと再帰起動防止のため SIGTERM で終了します。

```bash
# 別ターミナルを開いてから実行
node scripts/run-prototype.mjs \
  --issue-id NEX-102 \
  --claude-mode cli \
  --linear-mode fixture \
  --github-mode draft-only \
  --workspace-mode scaffold
```

実 repo の git worktree を使う場合：

```bash
node scripts/run-prototype.mjs \
  --claude-mode cli \
  --workspace-mode git-worktree \
  --repo-root /path/to/target-repo \
  --base-ref main \
  --github-mode local-commit
```

### 3. 実 API をフル使用 (Linear + GitHub + Claude)

```bash
export LINEAR_API_KEY=...
export GITHUB_TOKEN=...
export GITHUB_OWNER=your-org
export GITHUB_REPO=your-repo

node scripts/run-prototype.mjs \
  --linear-mode api \
  --claude-mode cli \
  --github-mode api \
  --notify-linear \
  --workspace-mode git-worktree \
  --repo-root /path/to/target-repo \
  --base-ref main
```

### 4. Webhook サーバーを立ち上げる

```bash
pnpm webhook
# または開発用 (--watch)
pnpm webhook:dev
```

Linear の Webhook 設定で `POST https://<your-host>/webhook/linear` を登録し、
issue に `ai-ready` ラベルを付けると自動でオーケストレーターが起動します。

**ローカルテスト (ngrok などで外部公開してから):**

```bash
# 署名検証あり
curl -X POST http://localhost:3000/webhook/linear \
  -H "Content-Type: application/json" \
  -H "linear-signature: <hmac-sha256>" \
  -d '{"type":"Issue","action":"update","data":{"identifier":"NEX-101","labels":[{"name":"ai-ready"}]}}'

# ヘルスチェック
curl http://localhost:3000/health
```

### 5. テスト

```bash
pnpm test
```

## CLI オプション一覧

| オプション | デフォルト | 説明 |
|---|---|---|
| `--issue-id` | `NEX-101` | 対象 issue ID |
| `--linear-mode` | `fixture` | `fixture` / `api` |
| `--claude-mode` | `stub` | `stub` / `cli` |
| `--github-mode` | `draft-only` | `draft-only` / `local-commit` / `api` |
| `--github-target` | `pr-draft` | `pr-draft` / `issue-comment` |
| `--workspace-mode` | `scaffold` | `scaffold` / `git-worktree` |
| `--repo-root` | `cwd` | git-worktree 時の対象 repo パス |
| `--base-ref` | `HEAD` | git-worktree のベースブランチ |
| `--notify-linear` | `false` | Linear に結果コメントを返す |
| `--output-dir` | `/tmp/nexus-linear-poc-runs` | run artifacts 出力先 |
| `--quiet` | `false` | ログ抑制 |
| `--no-artifacts` | `false` | artifacts 出力をスキップ |

## 実行アーティファクト

各 run は `/tmp/nexus-linear-poc-runs/<runId>/` に保存されます：

```
<runId>/
├── run.json                      # run メタデータ
├── logs/
│   ├── claude-system-prompt.txt  # Claude に渡したプロンプト
│   └── claude-user-prompt.md
└── artifacts/
    ├── run-summary.json
    ├── execution-context.json
    ├── ontology-context.json
    ├── claude-input.md
    ├── github-pr-draft.md        # または issue-comment.md
    ├── github-publication.json
    └── linear-update.json
```

## フェーズ状況

| フェーズ | 状態 | 内容 |
|---|---|---|
| Phase 1 | ✅ 完了 | orchestrator / 全パッケージ / integration tests |
| Phase 2 (今ここ) | 🔧 進行中 | webhook-gateway 実装済み、Claude CLI 実動作確認中 |
| Phase 3 | 📋 予定 | run 状態永続化、worktree cleanup、並列実行対応 |

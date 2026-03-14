# System Overview

## 目的

Linear issue を入口にして、Claude Code が isolated branch / worktree 上で修正し、GitHub PR を返し、その結果を Linear に戻すまでの責務境界を定義する。

## コンテキスト

- 対象は `1 team / 1 repo`
- merge は必ず人間
- 低リスク task のみ対象
- `1 issue = 1 isolated 実行環境`

## コンポーネント

### `apps/orchestrator`

- job の開始点
- issue 取得
- policy 判定
- run 状態管理
- Claude Code 実行の制御
- GitHub / Linear への結果反映

### `packages/linear-client`

- issue 取得
- 実行開始 / 完了 / 失敗の返却
- webhook 受信後の補助 API 呼び出し

### `packages/github-client`

- branch / worktree に紐づく Git 操作
- PR 作成
- PR URL 取得

### `packages/claude-runner`

- Claude Code CLI / SDK 呼び出し
- prompt 組み立て
- 実行ログ採取

### `packages/policy-engine`

- `ai-ready` などの実行可否判定
- 禁止操作の制約付与
- 対象 issue の安全性フィルタ

### `runner-manager` Phase 2 以降

- `/tmp/nexus-linear-poc-runs/<run-id>` 配下に実行環境を作る
- worktree / container の寿命管理

## データ境界

- **入力**:
  - Linear issue 本文
  - title
  - labels
  - assignee
  - team / status
- **中間データ**:
  - run id
  - branch 名
  - worktree path
  - Claude 実行入力
  - lint / test ログ
- **出力**:
  - PR URL
  - 実行結果サマリ
  - Linear 返却メッセージ

## 配置方針

- プロジェクト本体: `/Users/uryuatsuya/nexus-linear-poc`
- 一時 worktree / run directory: `/tmp/nexus-linear-poc-runs`
- 永続ログ / 成果物:
  - 暫定: repo 内の docs と test fixture
  - 本命: `~/Library/Application Support/nexus-linear-poc` または `~/Documents/NEXUS-Data`

## 実行境界

- 1 issue ごとに run id を採番する
- 1 run ごとに branch / worktree を分離する
- lint / test 成功時のみ PR 作成へ進む
- 失敗時は PR 作成をスキップし、Linear へ失敗理由を返す

# ADR-001 Runtime and Operating Model

- **Status**: Accepted
- **Date**: 2026-03-11

## Context

PoC の目的は、Linear issue を入口にして Claude Code に実装を委譲し、GitHub PR を返せる最小運用を検証することにある。  
この段階では拡張性よりも、境界条件を狭く固定して完走可能性を優先する必要がある。

## Decision

以下を PoC の固定前提とする。

1. **対象範囲**
   - `1 team / 1 repo`
   - 低リスク task のみ
   - merge は人間のみ

2. **実装ランタイム**
   - Node.js 上で動かす
   - 実装言語は TypeScript を採用する
   - Claude Code は CLI または SDK で呼び出せる抽象境界を置く

3. **実行ディレクトリ**
   - プロジェクト本体: `/Users/uryuatsuya/nexus-linear-poc`
   - 実行用一時ディレクトリ: `/tmp/nexus-linear-poc-runs`
   - 永続データ保存候補: `~/Library/Application Support/nexus-linear-poc` または `~/Documents/NEXUS-Data`

4. **実行モデル**
   - `1 issue = 1 isolated 実行環境`
   - branch 命名規則は `codex/<linear-issue-id>-<slug>`
   - lint / test 成功時のみ PR 作成へ進む
   - 失敗時は Linear に理由を返す

5. **導入順序**
   - Phase 1 は手動起動
   - Phase 2 で `label=ai-ready` を自動起動候補にする
   - webhook gateway と runner manager は Phase 2 以降で分離する

## Consequences

### 良い点

- PoC の成功条件が明確になる
- branch / worktree の衝突回避を初期から設計に組み込める
- 実装責務が `orchestrator`、`client`、`runner` に整理される

### 悪い点

- 最初から複数 repo や高度な権限管理には対応しない
- TypeScript 化の判断により、現行の仮実装は後続で移行コストが発生する
- 永続ログ基盤は PoC では暫定運用になる

## Follow-ups

- 対象 repo を 1 つ確定する
- trigger 条件を Phase 1 と Phase 2 で明文化する
- Claude Code の CLI / SDK どちらを正規ルートにするか決める

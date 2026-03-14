# Linear + Claude Code 開発自動化 PoC

## 要件ブリーフ

- **タイトル**: Linear + Claude Code 開発自動化 PoC
- **課題**: issue 管理と実装作業が分断されており、AI に実装タスクを安全に委譲する運用と境界条件が未整備である。
- **目的**: Linear issue を入口にして、Claude Code に実装タスクを渡し、分離された branch/worktree 上で修正を行い、PR を返し、結果を Linear に返却できることを検証する。
- **対象ユーザー**:
  - 開発者
  - PM
  - レビュー担当
- **スコープ(in)**:
  - Linear issue を起点に job を起動する
  - issue 文脈を Claude Code に渡す
  - 専用 branch / worktree で作業する
  - lint / test を実行する
  - GitHub 上に PR を作成する
  - Linear に開始 / 完了 / 失敗結果を返す
- **スコープ(out)**:
  - 自動 merge
  - 本番デプロイ
  - 複数 repo 同時対応
  - 大規模な権限管理
  - 長期保管を前提とした高度な監査基盤
- **制約**:
  - 最初は `1 team / 1 repo` だけを対象にする
  - merge は必ず人間が行う
  - 低リスク task のみを対象にする
  - `1 issue = 1 isolated 実行環境` を守る
  - 失敗時は PR を作らず、理由を Linear に返せることを優先する
- **成功指標**:
  - 3 件以上の issue で PR 生成まで完走できる
  - issue から PR URL を返せる
  - 並列実行でも branch / worktree が衝突しない
  - 失敗時に Linear 側へ理由を返せる
- **前提/仮定**:
  - GitHub をコード管理に使う
  - PoC の実装言語は TypeScript / Node.js を採用する
  - Claude Code は CLI または SDK 経由で呼び出す
  - Linear は webhook / API を使う
  - プロジェクト本体は `/Users/uryuatsuya/nexus-linear-poc` に置く
  - 実行用 worktree / 一時ディレクトリは `/tmp/nexus-linear-poc-runs` を使う

## PoC で成立させること

PoC の最初のゴールは、`Linear の issue を起点に、Claude Code が別 branch で修正し、PR を返せること` である。  
このゴールに直接関係しない仕組みは後続フェーズへ送る。

## 主要ユースケース

- **As a** PM
- **I want** Linear issue を `ai-ready` 相当の条件で実行対象にできる
- **So that** AI に渡してよい task だけを明示的に流せる

- **As a** 開発者
- **I want** issue の内容が Claude Code に十分な文脈付きで渡る
- **So that** 人手で毎回追加説明しなくても修正案と PR を得られる

- **As a** レビュー担当
- **I want** AI が isolated branch で作った変更の PR を受け取りたい
- **So that** merge 判断を人間の責任で行える

## 成立条件

1. Linear issue を起点に 1 件の job を起動できる
2. 対象 repo に対して issue 単位の branch / worktree を作成できる
3. Claude Code に issue 文脈を渡して修正作業を実行できる
4. lint / test 結果を採取できる
5. GitHub に PR を作成し、その URL を取得できる
6. Linear issue へ開始 / 成功 / 失敗結果を返せる

## Phase 0 で決めること

- トリガー条件
- 対象 repo
- issue template
- Linear status 運用
- branch 命名規則
- worktree / 実行ディレクトリの配置
- Claude Code の呼び出し方式

## この PoC の推奨判断

- **リポジトリ構成**: 当面は 1 repo に寄せる
- **実行入口**: Phase 1 は手動実行、Phase 2 で `label=ai-ready` を標準トリガー候補にする
- **branch 命名規則**: `codex/<linear-issue-id>-<slug>`
- **実行分離**: `/tmp/nexus-linear-poc-runs/<run-id>` 配下に issue ごとの isolated worktree を作る
- **結果反映**: GitHub で PR を作成し、Linear には PR URL と実行結果要約を返す
- **人間の責任境界**: merge / deploy / 高リスク変更は人間のみ

## フェーズ案

### Phase 0: 要件定義

- トリガー条件を決める
- 対象 repo を 1 つ決める
- issue template と status を決める
- branch 命名規則を決める

### Phase 1: 手動 PoC

- Linear issue を見て人が Claude Code を起動する
- branch 作成、PR 作成、Linear 更新までを手順化する

### Phase 2: 半自動化

- `label=ai-ready` で job を作成する
- Linear への開始 / 完了コメントを自動化する

### Phase 3: 並列化

- `1 issue = 1 container/worktree` に分離する
- queue、同時実行数、timeout を追加する

### Phase 4: 運用化

- コスト制限
- 権限制御
- retry / 監視
- runbook 整備

## 最小構成

PoC 初期段階では、次の最小構成で十分とする。

```text
nexus-linear-poc/
  docs/
  apps/
    orchestrator/
  packages/
    linear-client/
    github-client/
    claude-runner/
  scripts/
  .github/workflows/
```

`webhook-gateway` と `runner-manager` は Phase 2 以降で切り出す。

## 将来を見据えた構成案

```text
nexus-linear-poc/
  docs/
    requirements/
      poc-v1.md
    architecture/
      system-overview.md
      sequence-linear-to-pr.md
    decisions/
      adr-001-runtime.md
  apps/
    webhook-gateway/
    orchestrator/
    runner-manager/
  packages/
    linear-client/
    github-client/
    claude-runner/
    shared-types/
    policy-engine/
  scripts/
    dev/
    ops/
  infra/
    docker/
    github/
    local/
  tests/
    integration/
    fixtures/
  .github/
    workflows/
  .env.example
  README.md
  pnpm-workspace.yaml
  package.json
```

## 役割分担

- **`docs/`**:
  - 要件、構造図、運用方針を管理する
- **`apps/orchestrator`**:
  - job 判定、実行オーケストレーション、状態管理を担う
- **`apps/webhook-gateway`**:
  - Linear webhook の受け口を担う
- **`apps/runner-manager`**:
  - worktree / 実行環境を作り、Claude Code を安全に走らせる
- **`packages/linear-client`**:
  - Linear API ラッパーを提供する
- **`packages/github-client`**:
  - branch / PR / status 反映を扱う
- **`packages/claude-runner`**:
  - Claude Code 呼び出しを共通化する
- **`packages/policy-engine`**:
  - 対象 issue 判定、禁止操作、制限ルールを持つ
- **`infra/`**:
  - Docker、GitHub Actions、ローカル実行周辺設定を置く

## 想定フロー

1. Linear issue が手動またはトリガー条件で実行対象になる
2. Orchestrator が issue を取得し、実行可否を判定する
3. 対象 repo に isolated branch / worktree を作る
4. Claude Code に issue 文脈と制約を渡して修正を実行する
5. lint / test を実行する
6. 結果を GitHub PR として作成する
7. Linear に PR URL と実行結果を返す

## 受け入れ基準

- **AC-1** Given 低リスクの Linear issue が 1 件ある When 手動で PoC job を起動する Then issue 文脈を使った isolated branch/worktree が生成される
- **AC-2** Given Claude Code が変更を生成した When lint / test を実行する Then 成否とログを run 単位で記録できる
- **AC-3** Given lint / test が成功した When GitHub 連携を行う Then PR が作成され、PR URL を取得できる
- **AC-4** Given PR URL を取得した When Linear へ結果を返す Then 対象 issue から PR への導線を確認できる
- **AC-5** Given 2 件以上の issue を並列実行する When branch / worktree を作成する Then 命名衝突や実行環境共有が発生しない
- **AC-6** Given 実行途中で失敗した When job を終了する Then 失敗理由を Linear へ返し、失敗箇所を特定できる

## 非機能要件

- **性能**:
  - PoC では厳密な SLA は持たない
  - ただし 1 run の開始から終了までを追跡できること
- **セキュリティ/プライバシー**:
  - GitHub / Linear / Claude の認証情報は環境変数または秘密情報ストアで扱う
  - Claude Code に渡す情報は対象 issue と対象 repo に限定する
- **信頼性**:
  - run ごとに一意の実行 ID を持つ
  - 途中失敗時に partial state を識別できる
- **観測性**:
  - 開始、branch 作成、Claude 実行、lint / test、PR 作成、Linear 更新の各イベントをログに残す
  - run 単位で入出力と結果サマリを確認できる
- **保守性**:
  - Linear / GitHub / Claude 呼び出しは package 単位で差し替え可能にする

## リスク & 依存関係

- **リスク**:
  - 対象 issue の粒度が粗いと Claude Code が安全に処理できない
  - isolated 実行環境が不十分だと branch / worktree 汚染が起きる
  - lint / test が不安定だと PR の品質基準が崩れる
  - Linear への返却仕様が曖昧だと運用フローが定着しない
- **依存関係**:
  - 対象 Linear team と issue template
  - 対象 GitHub repo と PR 作成権限
  - Claude Code の呼び出し方式と認証方式
  - ローカルまたは container ベースの isolated 実行環境

## 未決事項

- Q1. PoC の最初の対象 repo はどれにするか
- Q2. トリガー条件は Phase 2 で `label=ai-ready` に固定するか
- Q3. Claude Code は CLI を正規ルートにするか、SDK を正規ルートにするか
- Q4. Linear への結果返却は comment、status 更新、custom field のどれを採用するか
- Q5. PoC で本当に必要な並列数はいくつか

## 次の候補

1. 対象 repo を 1 つ決めて、Phase 1 手順書を `docs/architecture/sequence-linear-to-pr.md` に沿って具体化する
2. `apps/orchestrator` に run state モデルを追加し、branch / worktree / PR URL を 1 つの run summary として扱えるようにする
3. `packages/linear-client`、`packages/github-client`、`packages/claude-runner` の実 API 接続方式を ADR に沿って実装する

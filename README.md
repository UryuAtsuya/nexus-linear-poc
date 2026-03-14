# nexus-linear-poc

Linear issue を入口にして、Claude Code が isolated branch で修正し、GitHub PR を返せるかを検証する PoC。

## 現時点のゴール

PoC の最初の成立条件は次の 1 点に絞る。

- Linear の issue を起点に、Claude Code が別 branch で修正し、PR を返せること

## 主要ドキュメント

- [docs/requirements/poc-v1.md](./docs/requirements/poc-v1.md)
- [docs/architecture/system-overview.md](./docs/architecture/system-overview.md)
- [docs/architecture/sequence-linear-to-pr.md](./docs/architecture/sequence-linear-to-pr.md)
- [docs/decisions/adr-001-runtime.md](./docs/decisions/adr-001-runtime.md)
- [ontology/README.md](./ontology/README.md)

## パス前提

- プロジェクト本体: `/Users/uryuatsuya/nexus-linear-poc`
- 実行用一時ディレクトリ: `/tmp/nexus-linear-poc-runs`

## 現在のプロトタイプ

fixture / API / CLI を mode 切替で扱えるプロトタイプ。`orchestrator -> linear-client -> claude-runner -> github-client` の流れを JSON 出力として確認できる。
ontology も読み込み、issue に対する area / risk / related files を `ontologyContext` として返す。

```bash
npm run prototype -- --quiet
```

別の ontology ファイルを使う場合:

```bash
npm run prototype -- --quiet --ontology ontology/domain-model.json
```

実 repo から `git worktree` を切る場合:

```bash
npm run prototype -- --quiet --workspace-mode git-worktree --repo-root /path/to/target-repo --base-ref main
```

Claude Code CLI で変更し、ローカル commit まで進める場合:

```bash
npm run prototype -- --quiet --workspace-mode git-worktree --repo-root /path/to/target-repo --base-ref main --claude-mode cli --github-mode local-commit
```

Linear / GitHub の実 API を使う前提:

```bash
export LINEAR_API_KEY=...
export GITHUB_TOKEN=...
export GITHUB_OWNER=your-org
export GITHUB_REPO=your-repo
```

```bash
npm run prototype -- --quiet --linear-mode api --claude-mode cli --github-mode api --notify-linear --workspace-mode git-worktree --repo-root /path/to/target-repo --base-ref main
```

issue comment 出力の確認:

```bash
npm run prototype -- --quiet --github-target issue-comment --no-artifacts
```

テスト:

```bash
npm test
```

## 次の実装順

1. 実対象 repo を 1 つ確定する
2. `runner-manager` に worktree cleanup を入れる
3. `claude-runner` の prompt / allowed tools / verification を対象 repo 向けに固める
4. `github-client` の API mode を実 repo で検証する
5. `linear-client` の API mode と通知文面を運用ルールに合わせる

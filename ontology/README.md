# Ontology

このディレクトリには、Linear issue を PoC のドメイン概念へ写像するための最小 ontology を置く。

## 目的

- issue 文から対象領域を推定する
- Claude Code に渡す関連ファイル、テスト候補、リスク情報を構造化する
- high-risk な領域を自動実行の対象外にする判断材料を持つ

## ファイル

- `domain-model.json`
  - entity
  - relation
  - area
  - risk rule

## 使い方

- `apps/orchestrator` が issue を取得した後に ontology をロードする
- `packages/ontology-loader` が issue と ontology を照合して `ontologyContext` を返す
- `packages/policy-engine` が `ontologyContext.riskSummary` を見て実行可否を補正する
- `packages/claude-runner` が `ontologyContext` を prompt に含める

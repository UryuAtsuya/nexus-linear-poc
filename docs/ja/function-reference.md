# 関数リファレンス（和訳・解説）

このドキュメントは、プロトタイプを構成する主要な関数の説明を日本語に翻訳し、
初学者の方にも理解しやすいように解説を加えたものです。

---

## 1. `packages/linear-client/src/index.js`

### `createLinearClient(options?)`

**概要**
Linear API クライアントを作成して返す関数です。

**詳細説明**
Linear とのデータのやり取りを担当するオブジェクトを組み立てます。
動作モードは 2 種類あります。

- **fixture モード** — ネットワーク通信を行わず、ローカルの JSON ファイルからイシューデータを読み込みます。テストや開発時に便利です。
- **api モード** — Linear の GraphQL API に実際にアクセスし、最新のイシューデータを取得します。本番相当の動作です。

**引数**

| 引数 | 型 | 説明 |
|---|---|---|
| `fixturePath` | string（任意） | fixture モード用の JSON ファイルパス |
| `mode` | `"fixture"` \| `"api"`（任意） | 動作モードの明示的な指定 |
| `apiKey` | string（任意） | Linear API キー（未指定時は環境変数 `LINEAR_API_KEY` を使用） |
| `endpoint` | string（任意） | GraphQL エンドポイント URL |
| `fetchImpl` | Function（任意） | HTTP fetch の実装（デフォルトは `globalThis.fetch`） |
| `defaultRepository` | string \| null（任意） | イシューに紐づくデフォルトの `owner/repo` 文字列 |

**戻り値**
`{ getIssue, publishRunUpdate }` のメソッドを持つオブジェクトを返します。

---

#### `getIssue(issueId)`

**概要**
UUID またはイシュー識別子（例: `"NEX-101"`）を指定して、Linear イシューを取得します。
取得した生データは一定の形式（正規化スキーマ）に変換されてから返されます。

**引数**

| 引数 | 型 | 説明 |
|---|---|---|
| `issueId` | string | Linear イシューの UUID またはチームキー付き識別子（例: `NEX-1`） |

**戻り値**
正規化されたイシューオブジェクト（`Promise<object>`）

**初学者向け補足**
`NEX-101` のような識別子は「チームキー（NEX）＋連番（101）」に分解し、
GraphQL のフィルタークエリで検索しています。

---

#### `publishRunUpdate({ issue, status, body, linkUrl? })`

**概要**
Linear イシューに対して、実行結果のコメントを投稿します。
fixture モードでは実際には送信せず、`published: false` を返すだけです。

**引数**

| 引数 | 型 | 説明 |
|---|---|---|
| `issue` | object | 正規化された Linear イシューオブジェクト |
| `status` | string | 実行ステータスラベル（例: `"succeeded"`, `"failed"`） |
| `body` | string | コメント本文 |
| `linkUrl` | string \| null（任意） | コメントに含める URL |

**戻り値**
`{ published, commentId, url }` を含む投稿結果オブジェクト（`Promise<object>`）

---

## 2. `packages/policy-engine/src/index.js`

### `createPolicyEngine(options?)`

**概要**
イシューが自動実行の対象かどうかを判定するポリシーエンジンを作成します。

**詳細説明**
すべての判定条件を満たした場合にのみ、イシューは「承認（approved）」となります。
条件は以下の 5 つです。

1. イシューが `requiredLabels`（デフォルト: `"ai-ready"`）のラベルをすべて持っていること
2. イシューが `blockedLabels`（デフォルト: `"do-not-automate"`, `"high-risk"`）のラベルをひとつも持っていないこと
3. イシューの優先度が `allowedPriorities`（デフォルト: `low`, `medium`）に含まれること
4. イシューの状態が `allowedStates`（デフォルト: `backlog`, `todo`, `triage`, `in-progress`）に含まれること
5. オントロジーコンテキストが「人間によるレビュー必須」を要求していないこと

**引数**

| 引数 | 型 | 説明 |
|---|---|---|
| `requiredLabels` | string[]（任意） | 必須ラベルの一覧 |
| `blockedLabels` | string[]（任意） | 実行をブロックするラベルの一覧 |
| `allowedPriorities` | string[]（任意） | 許可された優先度の一覧 |
| `allowedStates` | string[]（任意） | 許可されたイシュー状態の一覧 |

**戻り値**
`{ evaluateIssue }` のメソッドを持つオブジェクトを返します。

---

#### `evaluateIssue(issue, context?)`

**概要**
設定済みのポリシールールに照らして Linear イシューを評価します。

**引数**

| 引数 | 型 | 説明 |
|---|---|---|
| `issue` | object | 正規化された Linear イシューオブジェクト |
| `context.ontologyContext` | object \| null（任意） | OntologyLoader が生成したリスク・エリア情報 |

**戻り値**
以下を含むオブジェクトを返します。

| フィールド | 型 | 説明 |
|---|---|---|
| `allowed` | boolean | 自動実行が許可されているか |
| `status` | string | `"approved"` または `"rejected"` |
| `reasons` | string[] | 拒否理由の一覧（空なら承認） |
| `checks` | object | 各チェック項目の合否詳細 |
| `constraints` | string[] | 適用された制約の説明文 |

---

## 3. `apps/orchestrator/src/index.js`

### `createLogger(options?)`

**概要**
シンプルなイベントロガーを作成します。

**詳細説明**
`log()` を呼び出すたびにタイムスタンプ付きのログエントリを生成します。
`silent: true` を指定するとコンソール出力を抑制できます。

**引数**

| 引数 | 型 | 説明 |
|---|---|---|
| `silent` | boolean（任意） | `true` にするとコンソール出力を抑制（デフォルト: `false`） |
| `sink` | Function（任意） | 出力先の関数（デフォルト: `console.log`） |

**戻り値**
`{ log }` のメソッドを持つオブジェクトを返します。

---

### `runPrototype(options?)`

**概要**
Linear → オントロジー → ポリシー → Claude → GitHub という一連のパイプラインを実行します。

**処理の流れ（ステップ）**

1. Linear からイシューを取得する（fixture またはAPIモード）
2. オントロジーコンテキストを構築し、リスクとエリアを分類する
3. ポリシーを評価する — 対象外なら `"blocked"` ステータスで中断する
4. RunnerManager 経由で git 作業ディレクトリ（worktree）を準備する
5. 実行コンテキストを構築して Claude に渡し、コード変更を実行させる
6. GitHub 向けの出力（PR ドラフトまたはイシューコメント）を準備する
7. GitHub に出力を公開する
8. （オプション）実行結果のコメントを Linear に投稿する
9. JSON・Markdown 成果物をディスクに保存する

**主な引数**

| 引数 | 型 | 説明 |
|---|---|---|
| `issueId` | string | Linear イシュー ID または識別子 |
| `fixturePath` | string | fixture JSON のパス（fixture モード） |
| `githubTarget` | `"pr-draft"` \| `"issue-comment"` | GitHub への出力先 |
| `outputDir` | string | 成果物を出力するベースディレクトリ |
| `ontologyPath` | string | オントロジードメインモデル JSON のパス |
| `workspaceMode` | `"scaffold"` \| `"git-worktree"` | 作業ディレクトリの作成方式 |
| `linearMode` | `"fixture"` \| `"api"` | Linear クライアントのモード |
| `claudeMode` | `"stub"` \| `"cli"` | Claude Runner のモード |
| `githubMode` | `"draft-only"` \| `"local-commit"` \| `"api"` | GitHub クライアントのモード |
| `notifyLinear` | boolean | Linear にステータスコメントを投稿するか |
| `writeArtifacts` | boolean | 成果物ファイルを書き出すか |

**戻り値**
`status`、`issue`、`runnerOutput`、`githubPublication`、`timeline` などを含む結果オブジェクト（`Promise<object>`）

---

### `main(argv?, io?)`

**概要**
CLI エントリーポイントです。

**詳細説明**
コマンドライン引数を解析して `runPrototype` を呼び出し、結果を JSON 形式で標準出力（成功時）または標準エラー出力（失敗時）に書き出します。
失敗時は `process.exitCode` を `1` にセットします。

**引数**

| 引数 | 型 | 説明 |
|---|---|---|
| `argv` | string[]（任意） | CLI 引数の配列（デフォルト: `process.argv.slice(2)`） |
| `io` | object（任意） | `stdout`／`stderr` を持つ I/O ストリームオブジェクト |

**戻り値**
実行結果オブジェクト（`Promise<object>`）

---

### `parseArgs(argv)`

**概要**
CLI 引数を `runPrototype` が消費するオプションオブジェクトに変換します。

**認識されるフラグ一覧**

| フラグ | デフォルト | 説明 |
|---|---|---|
| `--issue-id <id>` | `NEX-101` | Linear イシュー ID |
| `--fixture <path>` | （固定パス） | fixture JSON のパス |
| `--github-target <t>` | `pr-draft` | GitHub 出力先 |
| `--output-dir <dir>` | `/tmp/nexus-linear-poc-runs` | 成果物の出力ディレクトリ |
| `--ontology <path>` | （固定パス） | オントロジーモデルのパス |
| `--workspace-mode <m>` | `scaffold` | 作業ディレクトリの方式 |
| `--base-ref <ref>` | `HEAD` | git のベース参照 |
| `--linear-mode <m>` | `fixture` | Linear クライアントのモード |
| `--claude-mode <m>` | `stub` | Claude Runner のモード |
| `--github-mode <m>` | `draft-only` | GitHub クライアントのモード |
| `--notify-linear` | `false` | Linear へのコメント投稿を有効化 |
| `--repo-root <path>` | カレントディレクトリ | リポジトリのルートパス |
| `--no-artifacts` | （未指定） | 成果物ファイルの書き出しをスキップ |
| `--quiet` | `false` | ロガー出力を抑制 |

**引数**

| 引数 | 型 | 説明 |
|---|---|---|
| `argv` | string[] | 生の引数配列（例: `process.argv.slice(2)`） |

**戻り値**
解析済みのオプションオブジェクト

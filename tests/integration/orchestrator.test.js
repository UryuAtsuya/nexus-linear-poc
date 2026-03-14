import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import {
  main,
  parseArgs,
  runPrototype
} from "../../apps/orchestrator/src/index.js";
import { createGitHubClient } from "../../packages/github-client/src/index.js";
import { createLinearClient } from "../../packages/linear-client/src/index.js";

const execFileAsync = promisify(execFile);

test("runPrototype completes the fixture-based happy path and writes artifacts", async (t) => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "nexus-linear-run-"));
  t.after(async () => {
    await rm(outputDir, { recursive: true, force: true });
  });

  const result = await runPrototype({
    issueId: "NEX-101",
    fixturePath: "tests/fixtures/linear-issue.json",
    outputDir
  });

  assert.equal(result.status, "succeeded");
  assert.equal(result.issue.identifier, "NEX-101");
  assert.equal(result.ontologyContext.riskSummary.overallRisk, "low");
  assert.match(result.ontologyContext.ontology.path, /ontology\/domain-model\.json$/);
  assert.match(
    result.ontologyContext.relatedFiles.join("\n"),
    /apps\/orchestrator\/src\/index\.js/
  );
  assert.equal(result.policyDecision.allowed, true);
  assert.equal(result.githubOutput.target, "pr-draft");
  assert.equal(result.githubPublication.mode, "draft-only");
  assert.equal(result.githubPublication.published, false);
  assert.match(result.runnerOutput.branchName, /^codex\/nex-101-/);
  assert.equal(result.run.branchName, result.runnerOutput.branchName);
  assert.ok(result.artifacts);
  assert.match(result.artifacts.runDirectory, /nex-101$/);

  const summary = JSON.parse(await readFile(result.artifacts.summaryPath, "utf8"));
  const ontologyContext = JSON.parse(
    await readFile(result.artifacts.ontologyContextPath, "utf8")
  );
  const githubDraft = await readFile(result.artifacts.githubOutputPath, "utf8");
  const githubPublication = JSON.parse(
    await readFile(result.artifacts.githubPublicationPath, "utf8")
  );

  assert.equal(summary.status, "succeeded");
  assert.equal(summary.ontologyContext.riskSummary.overallRisk, "low");
  assert.equal(summary.policyDecision.status, "approved");
  assert.equal(summary.githubOutput.target, "pr-draft");
  assert.equal(ontologyContext.ontology.id, "nexus-linear-poc-ontology");
  assert.equal(githubPublication.mode, "draft-only");
  assert.match(githubDraft, /## Pull Request Title/);
  assert.deepEqual(
    result.timeline.map((entry) => entry.event),
    [
      "orchestrator.started",
      "linear.issue.loaded",
      "ontology.loaded",
      "policy.evaluated",
      "run.prepared",
      "orchestrator.context.built",
      "claude-runner.completed",
      "github.output.prepared",
      "github.output.published",
      "artifacts.saved",
      "orchestrator.completed"
    ]
  );
});

test("runPrototype returns a structured failure when the fixture issue is missing", async () => {
  const result = await runPrototype({
    issueId: "NEX-999",
    fixturePath: "tests/fixtures/linear-issue.json",
    writeArtifacts: false
  });

  assert.equal(result.status, "failed");
  assert.match(result.error.message, /NEX-999/);
  assert.equal(result.timeline.at(-1).event, "orchestrator.failed");
});

test("runPrototype blocks issues that do not satisfy the policy", async () => {
  const result = await runPrototype({
    issueId: "NEX-201",
    fixturePath: "tests/fixtures/linear-issue.json",
    writeArtifacts: false
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.policyDecision.allowed, false);
  assert.equal(result.ontologyContext.riskSummary.overallRisk, "low");
  assert.equal(result.run, null);
  assert.equal(result.executionContext, null);
  assert.match(result.policyDecision.reasons[0], /required labels/i);
  assert.deepEqual(
    result.timeline.map((entry) => entry.event),
    [
      "orchestrator.started",
      "linear.issue.loaded",
      "ontology.loaded",
      "policy.evaluated",
      "orchestrator.blocked"
    ]
  );
});

test("runPrototype can notify Linear in fixture mode without side effects", async () => {
  const result = await runPrototype({
    issueId: "NEX-201",
    fixturePath: "tests/fixtures/linear-issue.json",
    notifyLinear: true,
    writeArtifacts: false
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.linearUpdate.mode, "fixture");
  assert.equal(result.linearUpdate.published, false);
  assert.match(result.linearUpdate.body, /AI run update for NEX-201/);
  assert.equal(result.timeline.at(-1).event, "linear.update.published");
});

test("runPrototype blocks issues mapped to high-risk ontology areas", async () => {
  const result = await runPrototype({
    issueId: "NEX-301",
    fixturePath: "tests/fixtures/linear-issue.json",
    writeArtifacts: false
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.policyDecision.allowed, false);
  assert.equal(result.ontologyContext.riskSummary.overallRisk, "high");
  assert.match(result.policyDecision.reasons.join("\n"), /manual review/i);
});

test("runPrototype can emit an issue comment draft", async (t) => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "nexus-comment-run-"));
  t.after(async () => {
    await rm(outputDir, { recursive: true, force: true });
  });

  const result = await runPrototype({
    issueId: "NEX-102",
    fixturePath: "tests/fixtures/linear-issue.json",
    githubTarget: "issue-comment",
    outputDir
  });

  assert.equal(result.status, "succeeded");
  assert.equal(result.githubOutput.target, "issue-comment");
  assert.equal(result.githubDraft, null);
  assert.equal(result.githubPublication.mode, "draft-only");
  assert.match(result.githubOutput.body, /Prototype status for NEX-102/);
  assert.match(
    result.ontologyContext.matchedAreas.map((area) => area.id).join(","),
    /github-pr-output/
  );
  assert.match(result.executionContext.run.directories.worktreePath, /workspace/);

  const issueComment = await readFile(result.artifacts.githubOutputPath, "utf8");
  assert.match(issueComment, /## Comment Body/);
});

test("runPrototype creates isolated run directories for different issues", async (t) => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "nexus-isolated-runs-"));
  t.after(async () => {
    await rm(outputDir, { recursive: true, force: true });
  });

  const first = await runPrototype({
    issueId: "NEX-101",
    fixturePath: "tests/fixtures/linear-issue.json",
    outputDir
  });
  const second = await runPrototype({
    issueId: "NEX-102",
    fixturePath: "tests/fixtures/linear-issue.json",
    outputDir
  });

  assert.notEqual(first.run.runId, second.run.runId);
  assert.notEqual(first.run.directories.runDirectory, second.run.directories.runDirectory);
  assert.notEqual(first.run.branchName, second.run.branchName);
});

test("runPrototype can provision a real git worktree", async (t) => {
  const repoRoot = await createTempGitRepo();
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "nexus-worktree-run-"));

  t.after(async () => {
    await rm(outputDir, { recursive: true, force: true });
    await rm(repoRoot, { recursive: true, force: true });
  });

  const result = await runPrototype({
    issueId: "NEX-101",
    fixturePath: "tests/fixtures/linear-issue.json",
    outputDir,
    repoRoot,
    workspaceMode: "git-worktree",
    baseRef: "main"
  });

  assert.equal(result.status, "succeeded");
  assert.equal(result.run.workspaceMode, "git-worktree");
  assert.equal(result.run.baseRef, "main");
  assert.equal(result.executionContext.run.workspaceMode, "git-worktree");
  assert.equal(result.executionContext.run.baseRef, "main");

  const currentBranch = await runGit([
    "-C",
    result.run.directories.worktreePath,
    "rev-parse",
    "--abbrev-ref",
    "HEAD"
  ]);
  const readme = await readFile(
    path.join(result.run.directories.worktreePath, "README.md"),
    "utf8"
  );

  assert.equal(currentBranch, result.run.branchName);
  assert.match(readme, /temporary git repo/i);
});

test("runPrototype can execute claude cli mode and create a local commit", async (t) => {
  const repoRoot = await createTempGitRepo();
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "nexus-cli-run-"));

  t.after(async () => {
    await rm(outputDir, { recursive: true, force: true });
    await rm(repoRoot, { recursive: true, force: true });
  });

  const result = await runPrototype({
    issueId: "NEX-101",
    fixturePath: "tests/fixtures/linear-issue.json",
    outputDir,
    repoRoot,
    workspaceMode: "git-worktree",
    baseRef: "main",
    claudeMode: "cli",
    githubMode: "local-commit",
    writeArtifacts: false,
    claudeRunnerOptions: {
      command: "mock-claude",
      commandRunner: async (command, args, options) => {
        assert.equal(command, "mock-claude");
        assert.match(args.join(" "), /--output-format json/);
        assert.match(options.cwd, /workspace\/repo$/);

        await writeFile(
          path.join(options.cwd, "notes.md"),
          "Implemented by mock Claude runner.\n",
          "utf8"
        );

        return {
          stdout: JSON.stringify({
            summary: "Updated notes.md from Claude CLI mode.",
            commitMessage: "feat: add notes from claude cli",
            suggestedChanges: ["Add notes.md"],
            changedFiles: ["notes.md"],
            verification: [
              {
                command: "npm test",
                status: "passed"
              }
            ]
          })
        };
      }
    }
  });

  assert.equal(result.status, "succeeded");
  assert.equal(result.runnerOutput.mode, "cli");
  assert.equal(result.runnerOutput.commitMessage, "feat: add notes from claude cli");
  assert.deepEqual(result.runnerOutput.changedFiles, ["notes.md"]);
  assert.equal(result.githubPublication.mode, "local-commit");
  assert.equal(result.githubPublication.commit.created, true);
  assert.match(result.githubPublication.commit.commitSha, /^[a-f0-9]{40}$/);
  assert.deepEqual(result.githubPublication.commit.changedFiles, ["notes.md"]);

  const committedFiles = await runGit([
    "-C",
    result.run.directories.worktreePath,
    "show",
    "--name-only",
    "--pretty=",
    "HEAD"
  ]);

  assert.match(committedFiles, /notes\.md/);
});

test("createLinearClient uses the Linear API request shape", async () => {
  const requests = [];
  const client = createLinearClient({
    mode: "api",
    apiKey: "lin_api_test",
    defaultRepository: "nexus/poc",
    fetchImpl: async (url, init) => {
      requests.push({
        url,
        init
      });

      const payload = JSON.parse(init.body);

      if (payload.query.includes("query Issue")) {
        return createJsonResponse({
          data: {
            issue: {
              id: "lin_123",
              identifier: "NEX-900",
              title: "Fetched from API",
              description: "Loaded through GraphQL",
              priority: 4,
              state: {
                name: "Todo"
              },
              assignee: {
                email: "pm@nexus.dev"
              },
              labels: {
                nodes: [{ name: "ai-ready" }]
              },
              team: {
                key: "NEX"
              }
            }
          }
        });
      }

      return createJsonResponse({
        data: {
          commentCreate: {
            success: true,
            comment: {
              id: "comment_123",
              body: "posted",
              url: "https://linear.app/comment/123"
            }
          }
        }
      });
    }
  });

  const issue = await client.getIssue("NEX-900");
  const update = await client.publishRunUpdate({
    issue,
    status: "succeeded",
    body: "Prototype finished."
  });

  assert.equal(issue.identifier, "NEX-900");
  assert.equal(issue.priority, "low");
  assert.equal(issue.repository, "nexus/poc");
  assert.equal(update.published, true);
  assert.equal(update.url, "https://linear.app/comment/123");
  assert.equal(requests.length, 2);
  assert.equal(requests[0].init.headers.authorization, "lin_api_test");
  assert.match(requests[0].url, /api\.linear\.app\/graphql$/);
  assert.match(JSON.parse(requests[0].init.body).query, /query Issue/);
  assert.match(JSON.parse(requests[1].init.body).query, /mutation CommentCreate/);
});

test("createGitHubClient can publish a PR through the GitHub API adapter", async () => {
  const requests = [];
  const gitCommands = [];
  const client = createGitHubClient({
    mode: "api",
    token: "ghs_test",
    owner: "nexus",
    repo: "poc",
    fetchImpl: async (url, init) => {
      requests.push({
        url,
        init
      });

      return createJsonResponse({
        number: 42,
        html_url: "https://github.com/nexus/poc/pull/42"
      });
    },
    commandRunner: async (command, args) => {
      gitCommands.push([command, ...args]);

      if (args.includes("status")) {
        return {
          stdout: " M README.md\n"
        };
      }

      if (args.includes("rev-parse")) {
        return {
          stdout: "0123456789abcdef0123456789abcdef01234567\n"
        };
      }

      return {
        stdout: ""
      };
    }
  });

  const publication = await client.publishOutput({
    issue: {
      identifier: "NEX-101",
      repository: "nexus/poc"
    },
    output: {
      target: "pr-draft",
      branchName: "codex/nex-101-example",
      title: "[NEX-101] Example PR",
      body: "Body"
    },
    runnerOutput: {
      commitMessage: "feat: example"
    },
    run: {
      branchName: "codex/nex-101-example",
      directories: {
        worktreePath: "/tmp/example-repo"
      }
    },
    baseRef: "main"
  });

  assert.equal(publication.published, true);
  assert.equal(publication.pullRequest.number, 42);
  assert.equal(publication.pullRequest.url, "https://github.com/nexus/poc/pull/42");
  assert.equal(publication.commit.created, true);
  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /repos\/nexus\/poc\/pulls$/);
  assert.equal(JSON.parse(requests[0].init.body).draft, true);
  assert.ok(gitCommands.some((command) => command.includes("push")));
});

test("parseArgs supports the prototype CLI flags", () => {
  const options = parseArgs([
    "--issue-id",
    "NEX-201",
    "--fixture",
    "tests/fixtures/custom.json",
    "--github-target",
    "issue-comment",
    "--output-dir",
    "tmp/runs",
    "--ontology",
    "ontology/custom.json",
    "--workspace-mode",
    "git-worktree",
    "--base-ref",
    "main",
    "--linear-mode",
    "api",
    "--claude-mode",
    "cli",
    "--github-mode",
    "local-commit",
    "--notify-linear",
    "--repo-root",
    "/tmp/target-repo",
    "--no-artifacts",
    "--quiet"
  ]);

  assert.deepEqual(options, {
    issueId: "NEX-201",
    fixturePath: "tests/fixtures/custom.json",
    githubTarget: "issue-comment",
    outputDir: "tmp/runs",
    ontologyPath: "ontology/custom.json",
    workspaceMode: "git-worktree",
    baseRef: "main",
    linearMode: "api",
    claudeMode: "cli",
    githubMode: "local-commit",
    notifyLinear: true,
    repoRoot: "/tmp/target-repo",
    writeArtifacts: false,
    quiet: true
  });
});

test("main forwards CLI options to the orchestrator run", async (t) => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "nexus-main-run-"));
  t.after(async () => {
    await rm(outputDir, { recursive: true, force: true });
  });

  const stdout = [];
  const stderr = [];
  const result = await main(
    [
      "--issue-id",
      "NEX-101",
      "--fixture",
      "tests/fixtures/linear-issue.json",
      "--github-target",
      "issue-comment",
      "--output-dir",
      outputDir,
      "--ontology",
      "ontology/domain-model.json",
      "--workspace-mode",
      "scaffold",
      "--base-ref",
      "HEAD",
      "--linear-mode",
      "fixture",
      "--claude-mode",
      "stub",
      "--github-mode",
      "draft-only",
      "--repo-root",
      "/tmp/target-repo",
      "--no-artifacts",
      "--quiet"
    ],
    {
      stdout: {
        write(chunk) {
          stdout.push(chunk);
        }
      },
      stderr: {
        write(chunk) {
          stderr.push(chunk);
        }
      }
    }
  );

  assert.equal(result.githubOutput.target, "issue-comment");
  assert.equal(result.artifacts, null);
  assert.equal(result.executionContext.githubTarget, "issue-comment");
  assert.equal(result.executionContext.run.workspaceMode, "scaffold");
  assert.equal(result.executionContext.run.baseRef, "HEAD");
  assert.equal(result.executionContext.integrations.linearMode, "fixture");
  assert.equal(result.executionContext.integrations.claudeMode, "stub");
  assert.equal(result.executionContext.integrations.githubMode, "draft-only");
  assert.match(
    result.executionContext.ontology.ontology.path,
    /ontology\/domain-model\.json$/
  );
  assert.equal(result.executionContext.repoRoot, "/tmp/target-repo");
  assert.equal(result.githubPublication.mode, "draft-only");
  assert.equal(stderr.length, 0);

  const payload = JSON.parse(stdout.join(""));
  assert.equal(payload.githubOutput.target, "issue-comment");
  assert.equal(payload.artifacts, null);
  assert.equal(payload.githubPublication.mode, "draft-only");
});

async function createTempGitRepo() {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "nexus-target-repo-"));

  await runGit(["init", "--initial-branch=main", repoRoot]);
  await runGit(["-C", repoRoot, "config", "user.name", "Codex Test"]);
  await runGit(["-C", repoRoot, "config", "user.email", "codex@example.com"]);
  await writeFile(path.join(repoRoot, "README.md"), "# temporary git repo\n", "utf8");
  await runGit(["-C", repoRoot, "add", "README.md"]);
  await runGit(["-C", repoRoot, "commit", "-m", "chore: initial commit"]);

  return repoRoot;
}

function createJsonResponse(payload) {
  return {
    ok: true,
    async json() {
      return payload;
    }
  };
}

async function runGit(args) {
  const { stdout } = await execFileAsync("git", args, { encoding: "utf8" });
  return stdout.trim();
}

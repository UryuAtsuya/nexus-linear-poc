import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { createLinearClient } from "../../../packages/linear-client/src/index.js";
import { createGitHubClient } from "../../../packages/github-client/src/index.js";
import { createClaudeRunner } from "../../../packages/claude-runner/src/index.js";
import { createOntologyLoader } from "../../../packages/ontology-loader/src/index.js";
import { createPolicyEngine } from "../../../packages/policy-engine/src/index.js";
import { createRunnerManager } from "../../../packages/runner-manager/src/index.js";

const DEFAULT_FIXTURE_PATH = "tests/fixtures/linear-issue.json";
const DEFAULT_ISSUE_ID = "NEX-101";
const DEFAULT_OUTPUT_DIR = "/tmp/nexus-linear-poc-runs";
const DEFAULT_GITHUB_TARGET = "pr-draft";
const DEFAULT_ONTOLOGY_PATH = "ontology/domain-model.json";
const DEFAULT_WORKSPACE_MODE = "scaffold";
const DEFAULT_BASE_REF = "HEAD";
const DEFAULT_LINEAR_MODE = "fixture";
const DEFAULT_CLAUDE_MODE = "stub";
const DEFAULT_GITHUB_MODE = "draft-only";
const DEFAULT_OBJECTIVE =
  "Validate the Linear -> Orchestrator -> Claude Runner -> GitHub prototype flow.";

export function createLogger({ silent = false, sink = console.log } = {}) {
  return {
    log(event, details = {}) {
      const entry = {
        at: new Date().toISOString(),
        event,
        details
      };

      if (!silent) {
        sink(`[${entry.at}] ${event} ${JSON.stringify(details)}`);
      }

      return entry;
    }
  };
}

export async function runPrototype({
  issueId = DEFAULT_ISSUE_ID,
  fixturePath = DEFAULT_FIXTURE_PATH,
  githubTarget = DEFAULT_GITHUB_TARGET,
  outputDir = DEFAULT_OUTPUT_DIR,
  ontologyPath = DEFAULT_ONTOLOGY_PATH,
  workspaceMode = DEFAULT_WORKSPACE_MODE,
  baseRef = DEFAULT_BASE_REF,
  linearMode = DEFAULT_LINEAR_MODE,
  claudeMode = DEFAULT_CLAUDE_MODE,
  githubMode = DEFAULT_GITHUB_MODE,
  notifyLinear = false,
  repoRoot = process.cwd(),
  writeArtifacts = true,
  linearClientOptions = {},
  claudeRunnerOptions = {},
  githubClientOptions = {},
  logger = createLogger({ silent: true })
} = {}) {
  const timeline = [];
  const pushEvent = (event, details = {}) => {
    const entry = logger.log(event, details);
    timeline.push(entry);
    return entry;
  };
  let loadedIssue = null;

  const linearClient = createLinearClient({
    fixturePath,
    mode: linearMode,
    defaultRepository:
      githubClientOptions.owner && githubClientOptions.repo
        ? `${githubClientOptions.owner}/${githubClientOptions.repo}`
        : null,
    ...linearClientOptions
  });
  const claudeRunner = createClaudeRunner({
    mode: claudeMode,
    ...claudeRunnerOptions
  });
  const githubClient = createGitHubClient({
    mode: githubMode,
    ...githubClientOptions
  });
  const ontologyLoader = createOntologyLoader({ ontologyPath });
  const policyEngine = createPolicyEngine();
  const runnerManager = createRunnerManager({ baseRunsDir: outputDir });

  pushEvent("orchestrator.started", {
    issueId,
    fixturePath,
    githubTarget,
    workspaceMode,
    baseRef,
    linearMode,
    claudeMode,
    githubMode,
    notifyLinear
  });

  try {
    const issue = await linearClient.getIssue(issueId);
    loadedIssue = issue;
    pushEvent("linear.issue.loaded", {
      issueId: issue.identifier,
      title: issue.title,
      mode: linearMode
    });

    const ontologyContext = await ontologyLoader.buildIssueContext(issue);
    pushEvent("ontology.loaded", {
      primaryArea: ontologyContext.primaryArea?.id ?? null,
      matchCount: ontologyContext.matchedAreas.length,
      overallRisk: ontologyContext.riskSummary.overallRisk
    });

    const policyDecision = policyEngine.evaluateIssue(issue, { ontologyContext });
    pushEvent("policy.evaluated", {
      allowed: policyDecision.allowed,
      reasonCount: policyDecision.reasons.length
    });

    if (!policyDecision.allowed) {
      const blocked = {
        status: "blocked",
        issue,
        ontologyContext,
        policyDecision,
        run: null,
        executionContext: null,
        runnerOutput: null,
        githubOutput: null,
        githubDraft: null,
        githubPublication: null,
        linearUpdate: null,
        artifacts: null,
        timeline
      };

      pushEvent("orchestrator.blocked", {
        reason: policyDecision.reasons[0] ?? "Issue is not eligible."
      });

      if (notifyLinear) {
        blocked.linearUpdate = await publishLinearUpdate({
          linearClient,
          issue,
          status: blocked.status,
          githubPublication: null,
          body: createStatusBody({
            status: blocked.status,
            issue,
            policyDecision
          })
        });
        pushEvent("linear.update.published", {
          published: blocked.linearUpdate.published,
          mode: blocked.linearUpdate.mode,
          url: blocked.linearUpdate.url ?? null
        });
      }

      return blocked;
    }

    const run = await runnerManager.prepareRun({
      issue,
      repoRoot,
      workspaceMode,
      baseRef
    });
    pushEvent("run.prepared", {
      runId: run.runId,
      branchName: run.branchName,
      workspaceMode: run.workspaceMode,
      worktreePath: run.directories.worktreePath
    });

    const executionContext = buildExecutionContext({
      issue,
      ontologyContext,
      run,
      repoRoot,
      policyDecision,
      githubTarget,
      fixturePath,
      linearMode,
      claudeMode,
      githubMode,
      objective: DEFAULT_OBJECTIVE
    });
    pushEvent("orchestrator.context.built", {
      githubTarget: executionContext.githubTarget,
      labelCount: executionContext.labels.length,
      branchName: executionContext.run.branchName,
      workspaceMode: executionContext.run.workspaceMode
    });

    const runnerOutput = await claudeRunner.run({
      issue,
      objective: DEFAULT_OBJECTIVE,
      executionContext,
      run
    });
    pushEvent("claude-runner.completed", {
      mode: runnerOutput.mode,
      branchName: runnerOutput.branchName,
      suggestedChangeCount: runnerOutput.suggestedChanges.length
    });

    const githubOutput = await githubClient.prepareOutput({
      issue,
      runnerOutput,
      target: githubTarget
    });
    pushEvent("github.output.prepared", {
      target: githubOutput.target,
      title: githubOutput.title
    });

    const githubPublication = await githubClient.publishOutput({
      issue,
      output: githubOutput,
      runnerOutput,
      run,
      baseRef
    });
    pushEvent("github.output.published", {
      mode: githubPublication.mode,
      published: githubPublication.published,
      reason: githubPublication.reason ?? null,
      url: githubPublication.pullRequest?.url ?? null
    });

    const result = {
      status: "succeeded",
      issue,
      ontologyContext,
      policyDecision,
      run,
      executionContext,
      runnerOutput,
      githubOutput,
      githubDraft: githubOutput.target === "pr-draft" ? githubOutput : null,
      githubPublication,
      linearUpdate: null,
      artifacts: null,
      timeline
    };

    if (notifyLinear) {
      result.linearUpdate = await publishLinearUpdate({
        linearClient,
        issue,
        status: result.status,
        githubPublication,
        body: createStatusBody({
          status: result.status,
          issue,
          runnerOutput,
          githubPublication
        })
      });
      pushEvent("linear.update.published", {
        published: result.linearUpdate.published,
        mode: result.linearUpdate.mode,
        url: result.linearUpdate.url ?? null
      });
    }

    if (writeArtifacts) {
      result.artifacts = await persistArtifacts({
        run,
        ontologyContext,
        executionContext,
        runnerOutput,
        githubOutput,
        githubPublication,
        linearUpdate: result.linearUpdate
      });
      pushEvent("artifacts.saved", {
        runDirectory: result.artifacts.runDirectory
      });
    }

    pushEvent("orchestrator.completed", { status: result.status });

    if (result.artifacts) {
      await writeSummaryFile(result.artifacts.summaryPath, result);
    }

    return result;
  } catch (error) {
    const failure = {
      status: "failed",
      error: {
        name: error.name,
        message: error.message
      },
      linearUpdate: null,
      timeline
    };

    pushEvent("orchestrator.failed", failure.error);

    if (notifyLinear && loadedIssue) {
      failure.linearUpdate = await publishLinearUpdate({
        linearClient,
        issue: loadedIssue,
        status: failure.status,
        githubPublication: null,
        body: createStatusBody({
          status: failure.status,
          issue: loadedIssue,
          error
        })
      });
      pushEvent("linear.update.published", {
        published: failure.linearUpdate.published,
        mode: failure.linearUpdate.mode,
        url: failure.linearUpdate.url ?? null
      });
    }

    return failure;
  }
}

export async function main(argv = process.argv.slice(2), io = process) {
  const options = parseArgs(argv);
  const logger = createLogger({ silent: options.quiet });
  const result = await runPrototype({
    issueId: options.issueId,
    fixturePath: options.fixturePath,
    githubTarget: options.githubTarget,
    outputDir: options.outputDir,
    ontologyPath: options.ontologyPath,
    workspaceMode: options.workspaceMode,
    baseRef: options.baseRef,
    linearMode: options.linearMode,
    claudeMode: options.claudeMode,
    githubMode: options.githubMode,
    notifyLinear: options.notifyLinear,
    repoRoot: options.repoRoot,
    writeArtifacts: options.writeArtifacts,
    logger
  });

  const output = JSON.stringify(result, null, 2);
  const writer = result.status === "succeeded" ? io.stdout : io.stderr;
  writer.write(`${output}\n`);

  if (result.status !== "succeeded") {
    process.exitCode = 1;
  }

  return result;
}

export function parseArgs(argv) {
  const options = {
    issueId: DEFAULT_ISSUE_ID,
    fixturePath: DEFAULT_FIXTURE_PATH,
    githubTarget: DEFAULT_GITHUB_TARGET,
    outputDir: DEFAULT_OUTPUT_DIR,
    ontologyPath: DEFAULT_ONTOLOGY_PATH,
    workspaceMode: DEFAULT_WORKSPACE_MODE,
    baseRef: DEFAULT_BASE_REF,
    linearMode: DEFAULT_LINEAR_MODE,
    claudeMode: DEFAULT_CLAUDE_MODE,
    githubMode: DEFAULT_GITHUB_MODE,
    notifyLinear: false,
    repoRoot: process.cwd(),
    writeArtifacts: true,
    quiet: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === "--issue-id") {
      options.issueId = argv[index + 1] ?? options.issueId;
      index += 1;
      continue;
    }

    if (token === "--fixture") {
      options.fixturePath = argv[index + 1] ?? options.fixturePath;
      index += 1;
      continue;
    }

    if (token === "--quiet") {
      options.quiet = true;
      continue;
    }

    if (token === "--github-target") {
      options.githubTarget = argv[index + 1] ?? options.githubTarget;
      index += 1;
      continue;
    }

    if (token === "--output-dir") {
      options.outputDir = argv[index + 1] ?? options.outputDir;
      index += 1;
      continue;
    }

    if (token === "--ontology") {
      options.ontologyPath = argv[index + 1] ?? options.ontologyPath;
      index += 1;
      continue;
    }

    if (token === "--workspace-mode") {
      options.workspaceMode = argv[index + 1] ?? options.workspaceMode;
      index += 1;
      continue;
    }

    if (token === "--base-ref") {
      options.baseRef = argv[index + 1] ?? options.baseRef;
      index += 1;
      continue;
    }

    if (token === "--linear-mode") {
      options.linearMode = argv[index + 1] ?? options.linearMode;
      index += 1;
      continue;
    }

    if (token === "--claude-mode") {
      options.claudeMode = argv[index + 1] ?? options.claudeMode;
      index += 1;
      continue;
    }

    if (token === "--github-mode") {
      options.githubMode = argv[index + 1] ?? options.githubMode;
      index += 1;
      continue;
    }

    if (token === "--notify-linear") {
      options.notifyLinear = true;
      continue;
    }

    if (token === "--repo-root") {
      options.repoRoot = argv[index + 1] ?? options.repoRoot;
      index += 1;
      continue;
    }

    if (token === "--no-artifacts") {
      options.writeArtifacts = false;
    }
  }

  return options;
}

function buildExecutionContext({
  issue,
  ontologyContext,
  run,
  repoRoot,
  policyDecision,
  githubTarget,
  fixturePath,
  linearMode,
  claudeMode,
  githubMode,
  objective
}) {
  return {
    source: {
      type: linearMode === "api" ? "linear-api" : "fixture",
      fixturePath: linearMode === "fixture" ? fixturePath : null
    },
    repoRoot: path.resolve(repoRoot),
    objective,
    githubTarget,
    issueIdentifier: issue.identifier,
    title: issue.title,
    description: issue.description,
    priority: issue.priority,
    labels: issue.labels,
    assignee: issue.assignee,
    repository: issue.repository,
    ontology: ontologyContext,
    integrations: {
      linearMode,
      claudeMode,
      githubMode
    },
    run: {
      runId: run.runId,
      branchName: run.branchName,
      workspaceMode: run.workspaceMode,
      baseRef: run.baseRef,
      repoRoot: run.repoRoot,
      directories: run.directories
    },
    policy: {
      status: policyDecision.status,
      reasons: policyDecision.reasons
    },
    constraints: [
      ...policyDecision.constraints,
      "Keep the flow deterministic for local prototype validation.",
      "Assume a single Linear issue per execution.",
      "Return output that can be transformed into a GitHub payload."
    ],
    expectedArtifacts: [
      "execution-context.json",
      "ontology-context.json",
      "claude-input.md",
      githubTarget === "issue-comment"
        ? "github-issue-comment.md"
        : "github-pr-draft.md",
      "run-summary.json"
    ]
  };
}

async function persistArtifacts({
  run,
  ontologyContext,
  executionContext,
  runnerOutput,
  githubOutput,
  githubPublication,
  linearUpdate
}) {
  const runDirectory = run.directories.runDirectory;
  const summaryPath = path.join(run.directories.artifactsDirectory, "run-summary.json");
  const executionContextPath = path.join(
    run.directories.artifactsDirectory,
    "execution-context.json"
  );
  const ontologyContextPath = path.join(
    run.directories.artifactsDirectory,
    "ontology-context.json"
  );
  const claudeInputPath = path.join(run.directories.artifactsDirectory, "claude-input.md");
  const githubOutputPath = path.join(
    run.directories.artifactsDirectory,
    githubOutput.target === "issue-comment"
      ? "github-issue-comment.md"
      : "github-pr-draft.md"
  );
  const githubPublicationPath = path.join(
    run.directories.artifactsDirectory,
    "github-publication.json"
  );
  const linearUpdatePath = path.join(
    run.directories.artifactsDirectory,
    "linear-update.json"
  );
  const runMetadataPath = path.join(runDirectory, "run.json");

  await mkdir(runDirectory, { recursive: true });
  await writeFile(runMetadataPath, `${JSON.stringify(run, null, 2)}\n`, "utf8");
  await writeFile(
    ontologyContextPath,
    `${JSON.stringify(ontologyContext, null, 2)}\n`,
    "utf8"
  );
  await writeFile(
    executionContextPath,
    `${JSON.stringify(executionContext, null, 2)}\n`,
    "utf8"
  );
  await writeFile(
    claudeInputPath,
    renderClaudeInput({ executionContext, runnerOutput }),
    "utf8"
  );
  await writeFile(githubOutputPath, renderGitHubOutput(githubOutput), "utf8");
  await writeFile(
    githubPublicationPath,
    `${JSON.stringify(githubPublication, null, 2)}\n`,
    "utf8"
  );
  await writeFile(linearUpdatePath, `${JSON.stringify(linearUpdate, null, 2)}\n`, "utf8");

  return {
    runId: run.runId,
    runDirectory,
    runMetadataPath,
    summaryPath,
    ontologyContextPath,
    executionContextPath,
    claudeInputPath,
    githubOutputPath,
    githubPublicationPath,
    linearUpdatePath
  };
}

async function writeSummaryFile(summaryPath, result) {
  await writeFile(summaryPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
}

async function publishLinearUpdate({
  linearClient,
  issue,
  status,
  body,
  githubPublication
}) {
  return linearClient.publishRunUpdate({
    issue,
    status,
    body,
    linkUrl: githubPublication?.pullRequest?.url ?? null
  });
}

function createStatusBody({
  status,
  issue,
  policyDecision = null,
  runnerOutput = null,
  githubPublication = null,
  error = null
}) {
  if (status === "blocked") {
    return [
      `Issue ${issue.identifier} was blocked before execution.`,
      "",
      ...(policyDecision?.reasons?.length
        ? ["Reasons:", ...policyDecision.reasons.map((reason) => `- ${reason}`)]
        : ["Reasons: none reported"])
    ].join("\n");
  }

  if (status === "failed") {
    return [
      `Issue ${issue.identifier} failed during orchestration.`,
      "",
      `Error: ${error?.message ?? "Unknown error"}`
    ].join("\n");
  }

  return [
    `Issue ${issue.identifier} completed successfully.`,
    "",
    `Summary: ${runnerOutput?.summary ?? "No summary reported."}`,
    ...(githubPublication?.pullRequest?.url
      ? [`PR: ${githubPublication.pullRequest.url}`]
      : [])
  ].join("\n");
}

function renderClaudeInput({ executionContext, runnerOutput }) {
  return [
    "# Claude Runner Input",
    "",
    `- Issue: ${executionContext.issueIdentifier}`,
    `- Title: ${executionContext.title}`,
    `- GitHub Target: ${executionContext.githubTarget}`,
    `- Branch: ${executionContext.run.branchName}`,
    `- Worktree: ${executionContext.run.directories.worktreePath}`,
    `- Claude Mode: ${executionContext.integrations.claudeMode}`,
    "",
    "## Objective",
    executionContext.objective,
    "",
    "## Constraints",
    ...executionContext.constraints.map((constraint) => `- ${constraint}`),
    "",
    "## Policy",
    `- Status: ${executionContext.policy.status}`,
    ...(executionContext.policy.reasons.length === 0
      ? ["- Reasons: none"]
      : executionContext.policy.reasons.map((reason) => `- ${reason}`)),
    "",
    "## Ontology",
    `- Primary Area: ${executionContext.ontology.primaryArea?.name ?? "unmatched"}`,
    `- Overall Risk: ${executionContext.ontology.riskSummary.overallRisk}`,
    ...(executionContext.ontology.relatedFiles.length === 0
      ? ["- Related Files: none"]
      : executionContext.ontology.relatedFiles.map((file) => `- Related File: ${file}`)),
    "",
    "## Issue Description",
    executionContext.description || "No description provided.",
    "",
    "## Suggested Changes",
    ...runnerOutput.suggestedChanges.map((change) => `- ${change}`),
    "",
    "## Prompt Preview",
    "### System",
    runnerOutput.prompts.system,
    "",
    "### User",
    runnerOutput.prompts.user
  ].join("\n");
}

function renderGitHubOutput(githubOutput) {
  if (githubOutput.target === "issue-comment") {
    return [
      "# GitHub Issue Comment Draft",
      "",
      "## Comment Body",
      githubOutput.body
    ].join("\n");
  }

  return [
    "# GitHub Pull Request Draft",
    "",
    "## Pull Request Title",
    githubOutput.title,
    "",
    "## Pull Request Body",
    githubOutput.body
  ].join("\n");
}

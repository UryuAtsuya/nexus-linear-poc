import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const DEFAULT_GITHUB_API_URL = "https://api.github.com";

export function createGitHubClient({
  mode = "draft-only",
  token = process.env.GITHUB_TOKEN,
  owner = process.env.GITHUB_OWNER,
  repo = process.env.GITHUB_REPO,
  gitBin = "git",
  fetchImpl = globalThis.fetch,
  commandRunner = execFileAsync
} = {}) {
  return {
    async prepareOutput({ issue, runnerOutput, target = "pr-draft" }) {
      if (target === "pr-draft") {
        return {
          target,
          branchName: runnerOutput.branchName,
          title: `[${issue.identifier}] ${issue.title}`,
          body: createPullRequestBody(issue, runnerOutput)
        };
      }

      if (target === "issue-comment") {
        return {
          target,
          branchName: runnerOutput.branchName,
          title: `Comment for ${issue.identifier}`,
          body: createIssueCommentBody(issue, runnerOutput)
        };
      }

      throw new Error(`Unsupported GitHub target: ${target}`);
    },

    async publishOutput({
      issue,
      output,
      runnerOutput,
      run,
      baseRef = "main",
      apiBaseUrl = DEFAULT_GITHUB_API_URL
    }) {
      if (mode === "draft-only") {
        return {
          mode,
          published: false,
          reason: "GitHub publish disabled in draft-only mode."
        };
      }

      const commit = await ensureCommit({
        gitBin,
        commandRunner,
        worktreePath: run.directories.worktreePath,
        commitMessage:
          runnerOutput.commitMessage ??
          `feat: implement ${issue.identifier.toLowerCase()} changes`
      });

      if (mode === "local-commit") {
        return {
          mode,
          published: false,
          reason: "Local commit completed. Remote publish skipped.",
          branchName: run.branchName,
          commit
        };
      }

      if (mode === "api") {
        const repository = resolveRepository({
          issueRepository: issue.repository,
          owner,
          repo
        });

        await runGit({
          gitBin,
          commandRunner,
          cwd: run.directories.worktreePath,
          args: ["push", "-u", "origin", run.branchName]
        });

        if (output.target !== "pr-draft") {
          throw new Error("GitHub API publish currently supports pr-draft only.");
        }

        const pullRequest = await createPullRequest({
          apiBaseUrl,
          token,
          fetchImpl,
          repository,
          output,
          baseRef
        });

        return {
          mode,
          published: true,
          branchName: run.branchName,
          commit,
          pullRequest
        };
      }

      throw new Error(`Unsupported GitHub mode: ${mode}`);
    }
  };
}

async function ensureCommit({
  gitBin,
  commandRunner,
  worktreePath,
  commitMessage
}) {
  const status = await runGit({
    gitBin,
    commandRunner,
    cwd: worktreePath,
    args: ["status", "--short"]
  });

  if (!status) {
    return {
      created: false,
      commitSha: null,
      changedFiles: []
    };
  }

  const changedFiles = status
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^[A-Z? ]+/, "").trim());

  await runGit({
    gitBin,
    commandRunner,
    cwd: worktreePath,
    args: ["add", "-A"]
  });
  await runGit({
    gitBin,
    commandRunner,
    cwd: worktreePath,
    args: ["commit", "-m", commitMessage]
  });

  const commitSha = await runGit({
    gitBin,
    commandRunner,
    cwd: worktreePath,
    args: ["rev-parse", "HEAD"]
  });

  return {
    created: true,
    commitSha,
    changedFiles
  };
}

async function createPullRequest({
  apiBaseUrl,
  token,
  fetchImpl,
  repository,
  output,
  baseRef
}) {
  if (!token) {
    throw new Error("GITHUB_TOKEN is required for GitHub API mode.");
  }

  if (typeof fetchImpl !== "function") {
    throw new Error("A fetch implementation is required for GitHub API mode.");
  }

  const response = await fetchImpl(
    `${apiBaseUrl}/repos/${repository.owner}/${repository.repo}/pulls`,
    {
      method: "POST",
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        title: output.title,
        body: output.body,
        head: output.branchName,
        base: baseRef,
        draft: true
      })
    }
  );

  if (!response.ok) {
    throw new Error(`GitHub PR creation failed with ${response.status}.`);
  }

  const payload = await response.json();

  return {
    number: payload.number ?? null,
    url: payload.html_url ?? null
  };
}

function resolveRepository({ issueRepository, owner, repo }) {
  const candidate = issueRepository ?? (owner && repo ? `${owner}/${repo}` : null);

  if (!candidate || !candidate.includes("/")) {
    throw new Error(
      "A GitHub repository in owner/repo form is required for publish mode."
    );
  }

  const [resolvedOwner, resolvedRepo] = candidate.split("/", 2);
  return {
    owner: resolvedOwner,
    repo: resolvedRepo
  };
}

async function runGit({ gitBin, commandRunner, cwd, args }) {
  const result = await commandRunner(gitBin, ["-C", cwd, ...args], {
    encoding: "utf8"
  });
  return String(result.stdout ?? "").trim();
}

function createPullRequestBody(issue, runnerOutput) {
  const changes = runnerOutput.suggestedChanges
    .map((change) => `- ${change}`)
    .join("\n");
  const verification =
    Array.isArray(runnerOutput.verification) && runnerOutput.verification.length > 0
      ? runnerOutput.verification
          .map(
            (step) =>
              `- ${step.command}: ${step.status}${step.details ? ` (${step.details})` : ""}`
          )
          .join("\n")
      : "- Not reported";

  return [
    "## Why",
    issue.description || "No issue description provided.",
    "",
    "## Prototype Summary",
    runnerOutput.summary,
    "",
    "## Suggested Changes",
    changes || "- None",
    "",
    "## Verification",
    verification
  ].join("\n");
}

function createIssueCommentBody(issue, runnerOutput) {
  const changes = runnerOutput.suggestedChanges
    .map((change) => `- ${change}`)
    .join("\n");

  return [
    `Prototype status for ${issue.identifier}: ready for review.`,
    "",
    "Summary:",
    runnerOutput.summary,
    "",
    "Suggested next steps:",
    changes || "- None"
  ].join("\n");
}

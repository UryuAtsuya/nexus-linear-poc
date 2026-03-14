import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const DEFAULT_RUNS_DIR = "/tmp/nexus-linear-poc-runs";
const DEFAULT_WORKSPACE_MODE = "scaffold";
const DEFAULT_BASE_REF = "HEAD";
const execFileAsync = promisify(execFile);

export function createRunnerManager({
  baseRunsDir = DEFAULT_RUNS_DIR,
  gitBin = "git"
} = {}) {
  return {
    async prepareRun({
      issue,
      repoRoot = process.cwd(),
      now = new Date(),
      workspaceMode = DEFAULT_WORKSPACE_MODE,
      baseRef = DEFAULT_BASE_REF
    }) {
      const runId = createRunId(issue.identifier, now);
      const branchName = createBranchName(issue.identifier, issue.title, now);
      const runDirectory = path.resolve(baseRunsDir, runId);
      const workspaceRoot = path.join(runDirectory, "workspace");
      const worktreePath = path.join(workspaceRoot, "repo");
      const logsDirectory = path.join(runDirectory, "logs");
      const artifactsDirectory = path.join(runDirectory, "artifacts");

      await Promise.all([
        mkdir(workspaceRoot, { recursive: true }),
        mkdir(logsDirectory, { recursive: true }),
        mkdir(artifactsDirectory, { recursive: true })
      ]);

      const preparedRepoRoot =
        workspaceMode === "git-worktree"
          ? await prepareGitWorktree({
              gitBin,
              repoRoot,
              worktreePath,
              branchName,
              baseRef
            })
          : await prepareScaffoldWorkspace({ worktreePath, repoRoot });

      return {
        runId,
        createdAt: now.toISOString(),
        branchName,
        workspaceMode,
        baseRef,
        repoRoot: preparedRepoRoot,
        directories: {
          runDirectory,
          workspaceRoot,
          worktreePath,
          logsDirectory,
          artifactsDirectory
        }
      };
    }
  };
}

export function createBranchName(issueIdentifier, title, now = new Date()) {
  const slugBase = slugify(`${issueIdentifier}-${title}`).slice(0, 48);
  return `codex/${slugBase}-${formatBranchStamp(now)}`;
}

function createRunId(issueIdentifier, now) {
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  return `${stamp}-${String(issueIdentifier).toLowerCase()}`;
}

async function prepareScaffoldWorkspace({ worktreePath, repoRoot }) {
  await mkdir(worktreePath, { recursive: true });
  return path.resolve(repoRoot);
}

async function prepareGitWorktree({
  gitBin,
  repoRoot,
  worktreePath,
  branchName,
  baseRef
}) {
  const resolvedRepoRoot = path.resolve(repoRoot);

  try {
    const topLevel = await runGit({
      gitBin,
      cwd: resolvedRepoRoot,
      args: ["rev-parse", "--show-toplevel"]
    });

    await runGit({
      gitBin,
      cwd: topLevel,
      args: ["worktree", "add", "-b", branchName, worktreePath, baseRef]
    });

    return topLevel;
  } catch (error) {
    const stderr = error.stderr?.trim();
    const stdout = error.stdout?.trim();
    const detail = stderr || stdout || error.message;
    throw new Error(`Failed to prepare git worktree: ${detail}`);
  }
}

async function runGit({ gitBin, cwd, args }) {
  const result = await execFileAsync(gitBin, ["-C", cwd, ...args], {
    encoding: "utf8"
  });
  return result.stdout.trim();
}

function formatBranchStamp(now) {
  const iso = now.toISOString();
  const match = iso.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{3})Z$/
  );

  if (!match) {
    return iso.replace(/[^0-9]/g, "").slice(0, 17);
  }

  return `${match[1]}${match[2]}${match[3]}-${match[4]}${match[5]}${match[6]}-${match[7]}`;
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

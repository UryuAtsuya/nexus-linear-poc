import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const DEFAULT_CLAUDE_COMMAND = process.env.CLAUDE_CODE_COMMAND ?? "claude";
const DEFAULT_PERMISSION_MODE = "acceptEdits";
const DEFAULT_ALLOWED_TOOLS = [
  "Read",
  "Edit",
  "Write",
  "MultiEdit",
  "Bash",
  "Glob",
  "Grep",
  "LS"
];
const RESULT_SCHEMA = JSON.stringify({
  type: "object",
  additionalProperties: true,
  required: ["summary", "commitMessage", "suggestedChanges"],
  properties: {
    summary: {
      type: "string"
    },
    commitMessage: {
      type: "string"
    },
    suggestedChanges: {
      type: "array",
      items: {
        type: "string"
      }
    },
    changedFiles: {
      type: "array",
      items: {
        type: "string"
      }
    },
    verification: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: true,
        required: ["command", "status"],
        properties: {
          command: {
            type: "string"
          },
          status: {
            type: "string"
          },
          details: {
            type: "string"
          }
        }
      }
    }
  }
});

export function createClaudeRunner({
  mode = "stub",
  command = DEFAULT_CLAUDE_COMMAND,
  args = [],
  model = process.env.CLAUDE_CODE_MODEL ?? null,
  permissionMode = DEFAULT_PERMISSION_MODE,
  allowedTools = DEFAULT_ALLOWED_TOOLS,
  commandRunner = execFileAsync
} = {}) {
  return {
    async run({ issue, objective, executionContext, run }) {
      const prompts = createPrompts({ issue, objective, executionContext, run });

      if (mode === "stub") {
        return createStubResult({ issue, objective, prompts, run });
      }

      if (mode === "cli") {
        return runClaudeCli({
          issue,
          objective,
          prompts,
          run,
          executionContext,
          command,
          args,
          model,
          permissionMode,
          allowedTools,
          commandRunner
        });
      }

      throw new Error(`Unsupported Claude runner mode: ${mode}`);
    }
  };
}

function createStubResult({ issue, objective, prompts, run }) {
  return {
    mode: "stub",
    objective,
    summary: [
      `Validated the prototype path for ${issue.identifier}.`,
      `Prepared a deterministic branch and PR draft suggestion for "${issue.title}".`
    ].join(" "),
    branchName: run.branchName,
    commitMessage: `feat: prototype ${issue.identifier.toLowerCase()} flow`,
    suggestedChanges: [
      "Create a real Linear API adapter.",
      "Replace the Claude runner stub with a live execution adapter.",
      "Decide how GitHub output should be persisted."
    ],
    changedFiles: [],
    verification: [],
    prompts,
    artifactPreview: {
      files: [
        "apps/orchestrator/src/index.js",
        "packages/linear-client/src/index.js",
        "packages/github-client/src/index.js"
      ]
    }
  };
}

async function runClaudeCli({
  issue,
  objective,
  prompts,
  run,
  executionContext,
  command,
  args,
  model,
  permissionMode,
  allowedTools,
  commandRunner
}) {
  const systemPromptPath = path.join(
    run.directories.logsDirectory,
    "claude-system-prompt.txt"
  );
  const userPromptPath = path.join(
    run.directories.logsDirectory,
    "claude-user-prompt.md"
  );

  await Promise.all([
    writeFile(systemPromptPath, `${prompts.system}\n`, "utf8"),
    writeFile(userPromptPath, `${prompts.user}\n`, "utf8")
  ]);

  const cliArgs = buildClaudeCliArgs({
    args,
    systemPrompt: prompts.system,
    userPrompt: prompts.user,
    model,
    permissionMode,
    allowedTools,
    worktreePath: run.directories.worktreePath
  });
  const commandResult = await commandRunner(command, cliArgs, {
    cwd: run.directories.worktreePath,
    encoding: "utf8",
    input: "",          // close stdin so claude doesn't wait for TTY input
    env: {
      ...process.env,
      NEXUS_ISSUE_ID: issue.identifier,
      NEXUS_OBJECTIVE: objective,
      NEXUS_BRANCH_NAME: run.branchName,
      NEXUS_WORKTREE_PATH: run.directories.worktreePath
    }
  });
  const rawOutput = String(commandResult.stdout ?? "").trim();
  const parsedOutput = parseClaudeOutput(rawOutput);
  const summary =
    parsedOutput.summary ??
    rawOutput ??
    `Claude CLI finished without structured output for ${issue.identifier}.`;

  return {
    mode: "cli",
    objective,
    summary,
    branchName: run.branchName,
    commitMessage:
      parsedOutput.commitMessage ??
      `feat: implement ${issue.identifier.toLowerCase()} via claude-code`,
    suggestedChanges:
      normalizeStringArray(parsedOutput.suggestedChanges).length > 0
        ? normalizeStringArray(parsedOutput.suggestedChanges)
        : [`Review Claude CLI output for ${issue.identifier}.`],
    changedFiles: normalizeStringArray(parsedOutput.changedFiles),
    verification: normalizeVerification(parsedOutput.verification),
    prompts,
    rawOutput,
    command: {
      bin: command,
      args: cliArgs
    },
    artifactPreview: {
      files:
        normalizeStringArray(parsedOutput.changedFiles).length > 0
          ? normalizeStringArray(parsedOutput.changedFiles)
          : executionContext.ontology.relatedFiles.slice(0, 5)
    }
  };
}

function buildClaudeCliArgs({
  args,
  systemPrompt,
  userPrompt,
  model,
  permissionMode,
  allowedTools,
  worktreePath
}) {
  const cliArgs = [...args];

  if (!cliArgs.includes("--print") && !cliArgs.includes("-p")) {
    cliArgs.push("--print");
  }

  if (!cliArgs.includes("--output-format")) {
    cliArgs.push("--output-format", "json");
  }

  if (!cliArgs.includes("--permission-mode")) {
    cliArgs.push("--permission-mode", permissionMode);
  }

  if (!cliArgs.includes("--json-schema")) {
    cliArgs.push("--json-schema", RESULT_SCHEMA);
  }

  if (allowedTools.length > 0 && !cliArgs.includes("--allowedTools")) {
    cliArgs.push("--allowedTools", allowedTools.join(","));
  }

  if (model && !cliArgs.includes("--model")) {
    cliArgs.push("--model", model);
  }

  if (!cliArgs.includes("--add-dir")) {
    cliArgs.push("--add-dir", worktreePath);
  }

  if (!cliArgs.includes("--system-prompt")) {
    cliArgs.push("--system-prompt", systemPrompt);
  }

  cliArgs.push(userPrompt);

  return cliArgs;
}

function createPrompts({ issue, objective, executionContext, run }) {
  return {
    system:
      "You are a coding agent helping convert a Linear issue into actionable implementation output. Work only inside the provided repository context, prefer minimal changes, and return a structured implementation summary.",
    user: [
      `Issue: ${issue.identifier} - ${issue.title}`,
      `Target: ${executionContext.githubTarget}`,
      `Objective: ${objective}`,
      `Branch: ${run.branchName}`,
      `Worktree: ${run.directories.worktreePath}`,
      `Repository: ${executionContext.repository ?? "unknown"}`,
      `Ontology Area: ${executionContext.ontology.primaryArea?.name ?? "unmatched"}`,
      `Ontology Risk: ${executionContext.ontology.riskSummary.overallRisk}`,
      `Related Files: ${executionContext.ontology.relatedFiles.join(", ") || "none"}`,
      `Suggested Tests: ${executionContext.ontology.suggestedTests.join(", ") || "none"}`,
      `Constraints: ${executionContext.constraints.join(" | ")}`,
      "",
      "Issue Description:",
      issue.description || "No description provided.",
      "",
      "Return JSON matching the provided schema."
    ].join("\n")
  };
}

function parseClaudeOutput(rawOutput) {
  if (!rawOutput) {
    return {};
  }

  try {
    const parsed = JSON.parse(rawOutput);

    if (parsed && typeof parsed === "object") {
      // --json-schema produces structured_output; prefer it over result
      if (parsed.structured_output && typeof parsed.structured_output === "object") {
        return parsed.structured_output;
      }
      if (parsed.result && typeof parsed.result === "object") {
        return parsed.result;
      }
      if (typeof parsed.result === "string" && parsed.result) {
        return { summary: parsed.result };
      }
    }

    return parsed;
  } catch {
    return {
      summary: rawOutput
    };
  }
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => String(entry ?? "").trim())
    .filter(Boolean);
}

function normalizeVerification(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((entry) => entry && typeof entry === "object")
    .map((entry) => ({
      command: String(entry.command ?? "").trim(),
      status: String(entry.status ?? "unknown").trim(),
      details: String(entry.details ?? "").trim()
    }))
    .filter((entry) => entry.command);
}

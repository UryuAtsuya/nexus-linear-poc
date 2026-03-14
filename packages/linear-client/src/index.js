import { readFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_LINEAR_ENDPOINT = "https://api.linear.app/graphql";

export function createLinearClient({
  fixturePath,
  mode = fixturePath ? "fixture" : "api",
  apiKey = process.env.LINEAR_API_KEY,
  endpoint = DEFAULT_LINEAR_ENDPOINT,
  fetchImpl = globalThis.fetch,
  defaultRepository = null
} = {}) {
  return {
    async getIssue(issueId) {
      if (mode === "fixture") {
        return getFixtureIssue({ fixturePath, issueId });
      }

      const payload = await requestLinearGraphQL({
        endpoint,
        apiKey,
        fetchImpl,
        query: `
          query Issue($id: String!) {
            issue(id: $id) {
              id
              identifier
              title
              description
              priority
              state {
                name
              }
              assignee {
                name
                email
              }
              labels {
                nodes {
                  name
                }
              }
              team {
                key
                name
              }
            }
          }
        `,
        variables: {
          id: issueId
        }
      });

      if (!payload.issue) {
        throw new Error(`Linear issue "${issueId}" was not found via API.`);
      }

      return normalizeIssue(payload.issue, { defaultRepository });
    },

    async publishRunUpdate({
      issue,
      status,
      body,
      linkUrl = null
    }) {
      const renderedBody = createLinearUpdateBody({
        issue,
        status,
        body,
        linkUrl
      });

      if (mode === "fixture") {
        return {
          mode,
          published: false,
          issueId: issue.id,
          body: renderedBody,
          reason: "Linear publish disabled in fixture mode."
        };
      }

      const payload = await requestLinearGraphQL({
        endpoint,
        apiKey,
        fetchImpl,
        query: `
          mutation CommentCreate($issueId: String!, $body: String!) {
            commentCreate(input: { issueId: $issueId, body: $body }) {
              success
              comment {
                id
                body
                url
              }
            }
          }
        `,
        variables: {
          issueId: issue.id,
          body: renderedBody
        }
      });

      if (!payload.commentCreate?.success) {
        throw new Error("Linear commentCreate did not report success.");
      }

      return {
        mode,
        published: true,
        issueId: issue.id,
        commentId: payload.commentCreate.comment?.id ?? null,
        url: payload.commentCreate.comment?.url ?? null,
        body: payload.commentCreate.comment?.body ?? renderedBody
      };
    }
  };
}

async function getFixtureIssue({ fixturePath, issueId }) {
  if (!fixturePath) {
    throw new Error("A fixturePath is required for fixture Linear mode.");
  }

  const resolvedFixturePath = path.resolve(process.cwd(), fixturePath);
  const raw = await readFile(resolvedFixturePath, "utf8");
  const parsed = JSON.parse(raw);
  const issues = Array.isArray(parsed) ? parsed : [parsed];
  const issue = issues.find(
    (candidate) => candidate.id === issueId || candidate.identifier === issueId
  );

  if (!issue) {
    throw new Error(`Linear issue "${issueId}" was not found in ${fixturePath}.`);
  }

  return normalizeIssue(issue);
}

async function requestLinearGraphQL({
  endpoint,
  apiKey,
  fetchImpl,
  query,
  variables
}) {
  if (!apiKey) {
    throw new Error("LINEAR_API_KEY is required for Linear API mode.");
  }

  if (typeof fetchImpl !== "function") {
    throw new Error("A fetch implementation is required for Linear API mode.");
  }

  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: apiKey
    },
    body: JSON.stringify({
      query,
      variables
    })
  });

  if (!response.ok) {
    throw new Error(`Linear API request failed with ${response.status}.`);
  }

  const payload = await response.json();

  if (payload.errors?.length) {
    const message = payload.errors.map((error) => error.message).join("; ");
    throw new Error(`Linear API error: ${message}`);
  }

  return payload.data;
}

function normalizeIssue(issue, { defaultRepository = null } = {}) {
  return {
    id: issue.id,
    identifier: issue.identifier ?? issue.id,
    title: issue.title ?? "Untitled issue",
    description: issue.description ?? "",
    priority: normalizePriority(issue.priority),
    labels: normalizeLabels(issue.labels),
    assignee: normalizeAssignee(issue.assignee),
    repository: issue.repository ?? defaultRepository,
    team: issue.team?.key ?? issue.team?.name ?? issue.team ?? "unknown",
    state: normalizeState(issue.state)
  };
}

function normalizeLabels(labels) {
  if (Array.isArray(labels)) {
    return labels;
  }

  if (Array.isArray(labels?.nodes)) {
    return labels.nodes.map((label) => label.name);
  }

  return [];
}

function normalizeAssignee(assignee) {
  if (!assignee) {
    return null;
  }

  return assignee.email ?? assignee.name ?? assignee;
}

function normalizeState(state) {
  if (!state) {
    return "backlog";
  }

  if (typeof state === "string") {
    return state.toLowerCase();
  }

  return String(state.name ?? "backlog").toLowerCase();
}

function normalizePriority(priority) {
  if (typeof priority === "string") {
    return priority.toLowerCase();
  }

  const numericPriority = Number(priority);

  if (Number.isNaN(numericPriority)) {
    return "medium";
  }

  if (numericPriority >= 4) {
    return "low";
  }

  if (numericPriority === 3) {
    return "medium";
  }

  if (numericPriority === 2) {
    return "high";
  }

  if (numericPriority === 1) {
    return "urgent";
  }

  return "medium";
}

function createLinearUpdateBody({ issue, status, body, linkUrl }) {
  return [
    `AI run update for ${issue.identifier}`,
    "",
    `Status: ${status}`,
    ...(linkUrl ? [`Link: ${linkUrl}`] : []),
    "",
    body
  ].join("\n");
}

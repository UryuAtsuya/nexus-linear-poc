const DEFAULT_REQUIRED_LABELS = ["ai-ready"];
const DEFAULT_BLOCKED_LABELS = ["do-not-automate", "high-risk"];
const DEFAULT_ALLOWED_PRIORITIES = ["low", "medium"];
const DEFAULT_ALLOWED_STATES = ["backlog", "todo", "triage", "in-progress"];

export function createPolicyEngine({
  requiredLabels = DEFAULT_REQUIRED_LABELS,
  blockedLabels = DEFAULT_BLOCKED_LABELS,
  allowedPriorities = DEFAULT_ALLOWED_PRIORITIES,
  allowedStates = DEFAULT_ALLOWED_STATES
} = {}) {
  return {
    evaluateIssue(issue, { ontologyContext = null } = {}) {
      const labels = new Set((issue.labels ?? []).map(normalize));
      const required = requiredLabels.map(normalize);
      const blocked = blockedLabels.map(normalize);
      const allowedPriority = allowedPriorities.map(normalize);
      const allowedState = allowedStates.map(normalize);
      const priority = normalize(issue.priority);
      const state = normalize(issue.state);
      const highRiskAreas =
        ontologyContext?.riskSummary?.highRiskAreas ?? [];
      const requiresManualReview =
        ontologyContext?.appliedRules?.some(
          (rule) => rule.effect === "manual-review-required"
        ) ?? false;
      const missingLabels = required.filter((label) => !labels.has(label));
      const matchedBlockedLabels = blocked.filter((label) => labels.has(label));
      const reasons = [];

      if (missingLabels.length > 0) {
        reasons.push(
          `Issue is missing required labels: ${missingLabels.join(", ")}.`
        );
      }

      if (matchedBlockedLabels.length > 0) {
        reasons.push(
          `Issue includes blocked labels: ${matchedBlockedLabels.join(", ")}.`
        );
      }

      if (!allowedPriority.includes(priority)) {
        reasons.push(
          `Issue priority "${issue.priority}" is outside the allowed PoC range.`
        );
      }

      if (!allowedState.includes(state)) {
        reasons.push(
          `Issue state "${issue.state}" is not eligible for automated execution.`
        );
      }

      if (requiresManualReview) {
        reasons.push(
          `Issue touches ontology areas that require manual review: ${highRiskAreas.join(", ")}.`
        );
      }

      return {
        allowed: reasons.length === 0,
        status: reasons.length === 0 ? "approved" : "rejected",
        reasons,
        checks: {
          missingLabels,
          matchedBlockedLabels,
          priorityAllowed: allowedPriority.includes(priority),
          stateAllowed: allowedState.includes(state),
          ontologyRiskAllowed: !requiresManualReview
        },
        constraints: [
          "Only low-risk issues are eligible for automated execution.",
          "Execution requires an explicit ai-ready signal.",
          "High-risk or blocked issues must be handled by a human."
        ]
      };
    }
  };
}

function normalize(value) {
  return String(value ?? "").trim().toLowerCase();
}

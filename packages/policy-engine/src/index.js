const DEFAULT_REQUIRED_LABELS = ["ai-ready"];
const DEFAULT_BLOCKED_LABELS = ["do-not-automate", "high-risk"];
const DEFAULT_ALLOWED_PRIORITIES = ["low", "medium"];
const DEFAULT_ALLOWED_STATES = ["backlog", "todo", "triage", "in-progress"];

/**
 * Creates a policy evaluation engine that determines whether an issue is
 * eligible for automated execution.
 *
 * Evaluation checks (all must pass for the issue to be approved):
 * 1. Issue must carry every label listed in `requiredLabels` (default: "ai-ready").
 * 2. Issue must not carry any label listed in `blockedLabels`
 *    (default: "do-not-automate", "high-risk").
 * 3. Issue priority must be in `allowedPriorities` (default: low, medium).
 * 4. Issue state must be in `allowedStates`
 *    (default: backlog, todo, triage, in-progress).
 * 5. Ontology context must not require manual review.
 *
 * @param {object} [options]
 * @param {string[]} [options.requiredLabels] - Labels that must be present.
 * @param {string[]} [options.blockedLabels]  - Labels that block execution.
 * @param {string[]} [options.allowedPriorities] - Permitted priority values.
 * @param {string[]} [options.allowedStates]     - Permitted state values.
 * @returns {{ evaluateIssue: Function }}
 */
export function createPolicyEngine({
  requiredLabels = DEFAULT_REQUIRED_LABELS,
  blockedLabels = DEFAULT_BLOCKED_LABELS,
  allowedPriorities = DEFAULT_ALLOWED_PRIORITIES,
  allowedStates = DEFAULT_ALLOWED_STATES
} = {}) {
  return {
    /**
     * Evaluates a Linear issue against the configured policy rules.
     *
     * @param {object} issue - Normalised Linear issue object.
     * @param {object} [context]
     * @param {object|null} [context.ontologyContext] - Risk/area context from OntologyLoader.
     * @returns {{ allowed: boolean, status: string, reasons: string[], checks: object, constraints: string[] }}
     */
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

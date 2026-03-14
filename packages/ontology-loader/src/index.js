import { readFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_ONTOLOGY_PATH = "ontology/domain-model.json";
const RISK_ORDER = {
  low: 1,
  medium: 2,
  high: 3
};

export function createOntologyLoader({
  ontologyPath = DEFAULT_ONTOLOGY_PATH
} = {}) {
  let cachedOntology = null;

  async function loadOntology() {
    if (cachedOntology) {
      return cachedOntology;
    }

    const resolvedPath = path.resolve(process.cwd(), ontologyPath);
    const raw = await readFile(resolvedPath, "utf8");
    cachedOntology = {
      ...JSON.parse(raw),
      resolvedPath
    };

    return cachedOntology;
  }

  return {
    async loadOntology() {
      return loadOntology();
    },
    async buildIssueContext(issue) {
      const ontology = await loadOntology();
      return buildIssueContextFromOntology({ ontology, issue });
    }
  };
}

function buildIssueContextFromOntology({ ontology, issue }) {
  const labels = new Set((issue.labels ?? []).map(normalize));
  const haystack = normalize([issue.title, issue.description].join(" "));
  const entityIndex = new Map(
    (ontology.entities ?? []).map((entity) => [entity.id, entity])
  );
  const matchedAreas = (ontology.areas ?? [])
    .map((area) => scoreArea({ area, labels, haystack }))
    .filter((area) => area.score > 0)
    .sort(compareAreas);

  const relatedEntities = uniqueById(
    matchedAreas.flatMap((area) =>
      (area.entities ?? [])
        .map((entityId) => entityIndex.get(entityId))
        .filter(Boolean)
    )
  ).map((entity) => ({
    id: entity.id,
    name: entity.name,
    type: entity.type,
    description: entity.description
  }));

  const relatedFiles = uniqueStrings([
    ...matchedAreas.flatMap((area) => area.relatedFiles ?? []),
    ...relatedEntities.flatMap(
      (entity) => entityIndex.get(entity.id)?.relatedFiles ?? []
    )
  ]);
  const suggestedTests = uniqueStrings(
    matchedAreas.flatMap((area) => area.suggestedTests ?? [])
  );
  const suggestedCommands = uniqueStrings(
    matchedAreas.flatMap((area) => area.suggestedCommands ?? [])
  );
  const overallRisk = deriveOverallRisk(matchedAreas);
  const primaryArea = selectPrimaryArea(matchedAreas, overallRisk);
  const appliedRules = applyRiskRules(ontology.riskRules ?? [], overallRisk);
  const highRiskAreas = matchedAreas
    .filter((area) => area.risk === "high")
    .map((area) => area.name);

  return {
    ontology: {
      id: ontology.id,
      version: ontology.version,
      path: ontology.resolvedPath
    },
    primaryArea: primaryArea
      ? {
          id: primaryArea.id,
          name: primaryArea.name,
          risk: primaryArea.risk,
          score: primaryArea.score
        }
      : null,
    matchedAreas: matchedAreas.map((area) => ({
      id: area.id,
      name: area.name,
      risk: area.risk,
      score: area.score,
      labelMatches: area.labelMatches,
      keywordMatches: area.keywordMatches
    })),
    entities: relatedEntities,
    relatedFiles,
    suggestedTests,
    suggestedCommands,
    riskSummary: {
      overallRisk,
      highRiskAreas,
      matchedAreaCount: matchedAreas.length
    },
    appliedRules
  };
}

function scoreArea({ area, labels, haystack }) {
  const labelMatches = (area.match?.labels ?? []).filter((label) =>
    labels.has(normalize(label))
  );
  const keywordMatches = (area.match?.keywords ?? []).filter((keyword) =>
    haystack.includes(normalize(keyword))
  );
  const score = labelMatches.length * 3 + keywordMatches.length;

  return {
    ...area,
    labelMatches,
    keywordMatches,
    score
  };
}

function compareAreas(left, right) {
  if (right.score !== left.score) {
    return right.score - left.score;
  }

  return (RISK_ORDER[right.risk] ?? 0) - (RISK_ORDER[left.risk] ?? 0);
}

function deriveOverallRisk(matchedAreas) {
  if (matchedAreas.some((area) => area.risk === "high")) {
    return "high";
  }

  if (matchedAreas.some((area) => area.risk === "medium")) {
    return "medium";
  }

  return "low";
}

function selectPrimaryArea(matchedAreas, overallRisk) {
  if (overallRisk === "high") {
    return matchedAreas.find((area) => area.risk === "high") ?? null;
  }

  return matchedAreas[0] ?? null;
}

function applyRiskRules(riskRules, overallRisk) {
  return riskRules
    .filter((rule) => normalize(rule.when?.areaRisk) === overallRisk)
    .map((rule) => ({
      id: rule.id,
      effect: rule.effect
    }));
}

function uniqueById(items) {
  const seen = new Set();
  const results = [];

  for (const item of items) {
    if (!item || seen.has(item.id)) {
      continue;
    }

    seen.add(item.id);
    results.push(item);
  }

  return results;
}

function uniqueStrings(items) {
  return [...new Set(items.filter(Boolean))];
}

function normalize(value) {
  return String(value ?? "").trim().toLowerCase();
}

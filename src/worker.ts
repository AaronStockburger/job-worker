import { ZBClient, ZBWorkerTaskHandler } from "zeebe-node";
import axios from "axios";
import "dotenv/config";

/* ========= Typen ========= */

type Weather = "gut" | "mittel" | "schlecht";
type Entscheidung = "standardVerfahren" | "erweiterteAnalyse";

type SegmentInput = {
  weather: Weather;
  incidents: number;
  currentLoad: number;
  expectedLoad: number;
};

type ProcessVars = {
  entscheidung?: Entscheidung; // <- genau diese Variable kommt aus Camunda

  segmentA_weather: Weather;
  segmentA_incidents: number;
  segmentA_currentLoad: number;
  segmentA_expectedLoad: number;

  segmentB_weather: Weather;
  segmentB_incidents: number;
  segmentB_currentLoad: number;
  segmentB_expectedLoad: number;

  segmentC_weather: Weather;
  segmentC_incidents: number;
  segmentC_currentLoad: number;
  segmentC_expectedLoad: number;

  segmentD_weather: Weather;
  segmentD_incidents: number;
  segmentD_currentLoad: number;
  segmentD_expectedLoad: number;
};

type AnalysisProfile = {
  id: "standard" | "extended";
  weatherWeights: Record<Weather, number>;
  incidentWeight: number;
  loadWeight: number;
  overloadBase: number;
};

type RecommendationCode = "NO_ACTION" | "MANUAL_REVIEW" | "MEASURE_REQUIRED";

type OutputVars = {
  segmentScores: Record<string, number>;
  topRiskSegment: string;
  overloadProbability: number;
  riskLevel: "LOW" | "MEDIUM" | "HIGH";

  recommendationCode: RecommendationCode;
  recommendationText: string;

  // welches Verfahren wurde tatsächlich genutzt
  analysisModeUsed: "standard" | "extended";
  decisionUsed: Entscheidung;
};

/* ========= Zeebe Client ========= */
const zbc = new ZBClient();

/* ========= Hilfsfunktionen ========= */

function toSegments(v: ProcessVars): Record<string, SegmentInput> {
  return {
    A: { weather: v.segmentA_weather, incidents: v.segmentA_incidents, currentLoad: v.segmentA_currentLoad, expectedLoad: v.segmentA_expectedLoad },
    B: { weather: v.segmentB_weather, incidents: v.segmentB_incidents, currentLoad: v.segmentB_currentLoad, expectedLoad: v.segmentB_expectedLoad },
    C: { weather: v.segmentC_weather, incidents: v.segmentC_incidents, currentLoad: v.segmentC_currentLoad, expectedLoad: v.segmentC_expectedLoad },
    D: { weather: v.segmentD_weather, incidents: v.segmentD_incidents, currentLoad: v.segmentD_currentLoad, expectedLoad: v.segmentD_expectedLoad },
  };
}

function scoreSegment(seg: SegmentInput, p: AnalysisProfile): number {
  const loadRatio = seg.expectedLoad === 0 ? 1 : seg.currentLoad / seg.expectedLoad;
  const loadPart = p.loadWeight * loadRatio;
  const incidentPart = p.incidentWeight * seg.incidents;
  const weatherPart = p.weatherWeights[seg.weather];

  const raw = weatherPart + incidentPart + loadPart;
  return Math.max(0, Math.min(100, Math.round(raw)));
}

function calcOverloadProbability(maxScore: number, p: AnalysisProfile): number {
  const prob = p.overloadBase + (maxScore / 100) * (1 - p.overloadBase);
  return Math.max(0, Math.min(1, Number(prob.toFixed(2))));
}

function riskLevelFrom(prob: number): "LOW" | "MEDIUM" | "HIGH" {
  if (prob < 0.4) return "LOW";
  if (prob < 0.7) return "MEDIUM";
  return "HIGH";
}

function recommendationFrom(prob: number): { code: RecommendationCode; text: string } {
  if (prob < 0.4) return { code: "NO_ACTION", text: "Keine Maßnahme nötig, weiter beobachten." };
  if (prob < 0.7) return { code: "MANUAL_REVIEW", text: "Manuelle Prüfung durch Netzingenieur empfohlen." };
  return { code: "MEASURE_REQUIRED", text: "Maßnahme erforderlich: Wartung/Verstärkung zeitnah einplanen." };
}

// Mapping: Camunda-Variable `entscheidung` -> JSON-Profil-ID
function mapEntscheidungToMode(e?: Entscheidung): { mode: "standard" | "extended"; decisionUsed: Entscheidung } {
  const decisionUsed: Entscheidung = e ?? "standardVerfahren";
  const mode: "standard" | "extended" = decisionUsed === "erweiterteAnalyse" ? "extended" : "standard";
  return { mode, decisionUsed };
}

/* ========= Job Handler ========= */

const handler: ZBWorkerTaskHandler<ProcessVars, Record<string, unknown>, OutputVars> = async (job) => {
  const vars = job.variables;

  // 1) Verfahren wählen (NACH deiner Entscheidung)
  const { mode, decisionUsed } = mapEntscheidungToMode(vars.entscheidung);
  console.log("Job erhalten – entscheidung =", decisionUsed, "=> analysisModeUsed =", mode);

  // 2) Profil holen (slowed-down JSON server simuliert Laufzeit)
  const profileUrl = `http://localhost:3000/analysisProfiles/${mode}`;
  console.log("Rufe Analyseprofil ab:", profileUrl);

  let profile: AnalysisProfile;
  try {
    profile = (await axios.get<AnalysisProfile>(profileUrl, { timeout: 30_000 })).data;
  } catch (err) {
    console.error("Fehler beim Laden des Analyseprofils", err);
    throw new Error("Risk analysis service unavailable");
  }

  // 3) Risiko berechnen
  const segments = toSegments(vars);
  const segmentScores: Record<string, number> = {};
  for (const [key, seg] of Object.entries(segments)) {
    segmentScores[key] = scoreSegment(seg, profile);
  }

  const [topRiskSegment] = Object.entries(segmentScores).sort((a, b) => b[1] - a[1])[0];
  const maxScore = segmentScores[topRiskSegment];

  const overloadProbability = calcOverloadProbability(maxScore, profile);
  const riskLevel = riskLevelFrom(overloadProbability);
  const rec = recommendationFrom(overloadProbability);

  console.log("Analyseergebnis:", {
    segmentScores,
    topRiskSegment,
    overloadProbability,
    riskLevel,
    recommendationCode: rec.code,
    analysisModeUsed: mode,
  });

  return job.complete({
    segmentScores,
    topRiskSegment,
    overloadProbability,
    riskLevel,
    recommendationCode: rec.code,
    recommendationText: rec.text,
    analysisModeUsed: mode,
    decisionUsed,
  });
};

/* ========= Worker starten ========= */

zbc.createWorker<ProcessVars, Record<string, unknown>, OutputVars>({
  taskType: "risk-analysis", // in BEIDEN Service Tasks gleich
  taskHandler: handler,
  timeout: 60_000,
  maxJobsToActivate: 1,
  pollInterval: 2000,
});

console.log('Job-Worker läuft (taskType="risk-analysis").');

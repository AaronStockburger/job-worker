import { ZBClient, ZBWorkerTaskHandler } from 'zeebe-node';
import axios from 'axios';

// Eingabe-/Header-/Ausgabe-Typen für den Job
type InputVars = {
  riskId?: number; // optional: aus dem Prozess steuerbar, sonst Default
};

type CustomHeaders = Record<string, unknown>;

type OutputVars = {
  id: number;
  segmentId: string;
  segmentType: string;
  currentLoadKw: number;
  expectedLoadKw: number;
  weather: 'gut' | 'mittel' | 'schlecht';
  incidentsLastYear: number;
  riskScore: number;
  topRiskSegment: string;
  overloadProbability: number;
  recommendation: string;
};

// Typ passend zu deiner db.json
type RiskEvaluation = {
  id: number;
  segmentId: string;
  segmentType: string;
  currentLoadKw: number;
  expectedLoadKw: number;
  weather: 'gut' | 'mittel' | 'schlecht';
  incidentsLastYear: number;
  riskScore: number;
  topRiskSegment: string;
  overloadProbability: number;
  recommendation: string;
};

// Camunda-Client (liest Cloud-Config aus Umgebungsvariablen)
const zbc = new ZBClient();

// Task-Handler implementieren
const handler: ZBWorkerTaskHandler<InputVars, CustomHeaders, OutputVars> = async (job) => {
  console.log('Job erhalten mit Variablen:', job.variables);

  // Falls vom Prozess keine riskId gesetzt wurde, nimm 1 (Segment A)
  const riskId = job.variables.riskId ?? 1;

  // Aufruf deines lokalen JSON-Servers
  const url = `http://localhost:3000/riskEvaluations/${riskId}`;
  console.log(`Rufe Risiko-Service auf: ${url}`);

  const response = await axios.get<RiskEvaluation>(url);
  const result = response.data;

  console.log('Risiko-Service Antwort:', result);

  // Ergebnis als Prozessvariablen zurückgeben
  return job.complete({
    id: result.id,
    segmentId: result.segmentId,
    segmentType: result.segmentType,
    currentLoadKw: result.currentLoadKw,
    expectedLoadKw: result.expectedLoadKw,
    weather: result.weather,
    incidentsLastYear: result.incidentsLastYear,
    riskScore: result.riskScore,
    topRiskSegment: result.topRiskSegment,
    overloadProbability: result.overloadProbability,
    recommendation: result.recommendation
  });
};

// Worker registrieren
zbc.createWorker<InputVars, CustomHeaders, OutputVars>({
  taskType: 'risk-analysis', // muss im BPMN-Service-Task genauso stehen
  taskHandler: handler
});

console.log('Job-Worker gestartet und wartet auf Jobs vom Typ "risk-analysis".');

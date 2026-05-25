const API = '/api/quiz';

export type SectionInfo = { id: number; name: string; range: string };
export type ExamScenarioInfo = { id: number; name: string; primaryDomains: string[] };
export type ExamMetadata = {
  examTitle: string;
  totalQuestions: number;
  sections: SectionInfo[];
  questionSource: string;
  aiGenerationAvailable: boolean;
  learningUrl: string | null;
  maxQuestionsPerSession: number;
  passingScore: number;
  scoreMin: number;
  scoreMax: number;
  practicePassingScore: number;
  responseFormat: string | null;
  examScenariosNote: string | null;
  scenarios: ExamScenarioInfo[] | null;
};

/** Full CCA-F exam: 60 questions, 120 minutes, 720 scaled pass. */
export const FULL_EXAM_TIME_SECONDS = 120 * 60;

export type SessionExamTargets = {
  questionCount: number;
  timeLimitSeconds: number;
  passingScore: number;
  practicePassingScore: number;
  scoreMin: number;
  scoreMax: number;
};

/** Time limit and scaled pass targets proportional to question count (baseline: 60 questions). */
export function getSessionExamTargets(
  questionCount: number,
  meta: ExamMetadata,
): SessionExamTargets {
  const ratio = questionCount / meta.totalQuestions;
  const scoreSpan = meta.scoreMax - meta.scoreMin;
  return {
    questionCount,
    timeLimitSeconds: Math.round(FULL_EXAM_TIME_SECONDS * ratio),
    passingScore: Math.round(meta.scoreMin + (meta.passingScore - meta.scoreMin) * ratio),
    practicePassingScore: Math.round(
      meta.scoreMin + (meta.practicePassingScore - meta.scoreMin) * ratio,
    ),
    scoreMin: meta.scoreMin,
    scoreMax: Math.round(meta.scoreMin + scoreSpan * ratio),
  };
}

/** Maps percent correct to the exam's 100–1000 scaled score range (full 60-question exam). */
export function toScaledScore(percentCorrect: number, meta: ExamMetadata): number {
  const range = meta.scoreMax - meta.scoreMin;
  return Math.round(meta.scoreMin + (percentCorrect / 100) * range);
}

/** Maps percent correct to the scaled range for this session size (keeps ~72% as pass). */
export function toSessionScaledScore(
  percentCorrect: number,
  targets: SessionExamTargets,
): number {
  const span = targets.scoreMax - targets.scoreMin;
  return Math.round(targets.scoreMin + (percentCorrect / 100) * span);
}

export type SessionDto = {
  sessionId: string;
  totalQuestions: number;
  questionIds: number[];
  sourceMode: string;
};

export type QuestionDto = {
  id: number;
  sectionId: number;
  sectionName: string;
  title: string;
  text: string;
  options: Record<string, string>;
  index: number;
  total: number;
};

export type AnswerSubmit = {
  index: number;
  total: number;
  selectedAnswer: string;
};

export type QuestionReviewItem = {
  index: number;
  sectionName: string;
  title: string;
  text: string;
  options: Record<string, string>;
  selectedAnswer: string;
  correctAnswer: string;
  isCorrect: boolean;
  explanation: string;
};

export type SessionReview = {
  sessionId: string;
  questions: QuestionReviewItem[];
};

export type SessionSummary = {
  sessionId: string;
  total: number;
  answered: number;
  correct: number;
  percentCorrect: number;
};

export async function fetchMetadata(): Promise<ExamMetadata> {
  const res = await fetch(`${API}/metadata`);
  if (!res.ok) throw new Error('Failed to load exam metadata');
  return res.json();
}

export async function createSession(
  count: number,
  sectionIds?: number[],
  source?: string,
  learningUrl?: string,
): Promise<SessionDto> {
  const res = await fetch(`${API}/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      count,
      sectionIds: sectionIds?.length ? sectionIds : null,
      source: source ?? null,
      learningUrl: learningUrl?.trim() || null,
    }),
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => '');
    throw new Error(msg || 'Failed to create practice session');
  }
  return res.json();
}

export async function fetchQuestion(sessionId: string, index: number): Promise<QuestionDto> {
  const res = await fetch(`${API}/sessions/${sessionId}/questions/${index}`);
  if (!res.ok) throw new Error('Failed to load question');
  return res.json();
}

export async function submitAnswer(
  sessionId: string,
  index: number,
  selectedAnswer: string,
): Promise<AnswerSubmit> {
  const res = await fetch(`${API}/sessions/${sessionId}/questions/${index}/answer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ selectedAnswer }),
  });
  if (!res.ok) throw new Error('Failed to submit answer');
  return res.json();
}

export async function fetchReview(sessionId: string): Promise<SessionReview> {
  const res = await fetch(`${API}/sessions/${sessionId}/review`);
  if (!res.ok) throw new Error('Failed to load answer review');
  return res.json();
}

export async function fetchSummary(sessionId: string): Promise<SessionSummary> {
  const res = await fetch(`${API}/sessions/${sessionId}/summary`);
  if (!res.ok) throw new Error('Failed to load summary');
  return res.json();
}

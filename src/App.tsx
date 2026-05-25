import { useCallback, useEffect, useRef, useState } from 'react';
import {
  QuestionDto,
  QuestionReviewItem,
  SessionDto,
  SessionSummary,
  createSession,
  fetchMetadata,
  fetchQuestion,
  fetchReview,
  fetchSummary,
  submitAnswer,
  type ExamMetadata,
  getSessionExamTargets,
  toSessionScaledScore,
  type SessionExamTargets,
} from './api';

type Screen = 'home' | 'quiz' | 'results';

function formatRemainingTime(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('home');
  const [meta, setMeta] = useState<ExamMetadata | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [questionCount, setQuestionCount] = useState(20);
  const [selectedSections, setSelectedSections] = useState<number[]>([]);
  const [useAiMode, setUseAiMode] = useState(false);
  const [learningUrl, setLearningUrl] = useState('');

  const [session, setSession] = useState<SessionDto | null>(null);
  const [index, setIndex] = useState(0);
  const [question, setQuestion] = useState<QuestionDto | null>(null);
  const [selectedLetter, setSelectedLetter] = useState<string | null>(null);
  const [summary, setSummary] = useState<SessionSummary | null>(null);
  const [review, setReview] = useState<QuestionReviewItem[]>([]);
  const [sessionTargets, setSessionTargets] = useState<SessionExamTargets | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const timeUpHandled = useRef(false);

  useEffect(() => {
    fetchMetadata()
      .then((m) => {
        setMeta(m);
        const ai = m.questionSource.toLowerCase() === 'ai';
        setUseAiMode(ai);
        setLearningUrl(m.learningUrl ?? '');
        const max = ai ? m.maxQuestionsPerSession : m.totalQuestions;
        setQuestionCount(Math.min(10, max));
      })
      .catch(() => setError('Cannot reach API. Start the .NET backend on port 5299.'));
  }, []);

  const toggleSection = (id: number) => {
    setSelectedSections((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id],
    );
  };

  const startPractice = async () => {
    if (!meta) return;
    setLoading(true);
    setError(null);
    try {
      const s = await createSession(
        questionCount,
        selectedSections.length ? selectedSections : undefined,
        useAiMode ? 'Ai' : 'Json',
        useAiMode ? learningUrl : undefined,
      );
      setSession(s);
      setIndex(0);
      setSelectedLetter(null);
      setReview([]);
      const q = await fetchQuestion(s.sessionId, 0);
      setQuestion(q);
      const targets = getSessionExamTargets(s.totalQuestions, meta);
      setSessionTargets(targets);
      setRemainingSeconds(targets.timeLimitSeconds);
      timeUpHandled.current = false;
      setScreen('quiz');
    } catch {
      setError('Failed to start session.');
    } finally {
      setLoading(false);
    }
  };

  const pickAnswer = async (letter: string) => {
    if (!session || selectedLetter) return;
    setSelectedLetter(letter);
    setLoading(true);
    try {
      await submitAnswer(session.sessionId, index, letter);
    } catch {
      setSelectedLetter(null);
      setError('Failed to submit answer.');
    } finally {
      setLoading(false);
    }
  };

  const finishSession = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    setError(null);
    try {
      const [sum, rev] = await Promise.all([
        fetchSummary(session.sessionId),
        fetchReview(session.sessionId),
      ]);
      setSummary(sum);
      setReview(rev.questions);
      setScreen('results');
    } catch {
      setError('Failed to load results.');
    } finally {
      setLoading(false);
    }
  }, [session]);

  const finishOrNext = useCallback(async () => {
    if (!session || !selectedLetter) return;
    const next = index + 1;
    setLoading(true);
    setError(null);
    try {
      if (next >= session.totalQuestions) {
        await finishSession();
        return;
      }
      setIndex(next);
      setSelectedLetter(null);
      const q = await fetchQuestion(session.sessionId, next);
      setQuestion(q);
    } catch {
      setError('Failed to continue.');
    } finally {
      setLoading(false);
    }
  }, [session, index, selectedLetter, finishSession]);

  const finishSessionRef = useRef(finishSession);
  finishSessionRef.current = finishSession;

  useEffect(() => {
    if (screen !== 'quiz' || !session) return;

    const tick = () => {
      setRemainingSeconds((prev) => Math.max(0, prev - 1));
    };

    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [screen, session?.sessionId]);

  useEffect(() => {
    if (screen !== 'quiz' || !session || remainingSeconds > 0 || timeUpHandled.current) {
      return;
    }
    timeUpHandled.current = true;
    setError('Time is up. Showing results for questions you answered.');
    void finishSessionRef.current();
  }, [remainingSeconds, screen, session]);

  const restart = () => {
    setScreen('home');
    setSession(null);
    setQuestion(null);
    setSummary(null);
    setReview([]);
    setIndex(0);
    setSessionTargets(null);
    setRemainingSeconds(0);
    timeUpHandled.current = false;
  };

  const previewTargets =
    meta && screen === 'home' ? getSessionExamTargets(questionCount, meta) : null;

  const resultsTargets =
    sessionTargets ??
    (meta && summary ? getSessionExamTargets(summary.total, meta) : null);

  const scaledScore =
    summary && resultsTargets
      ? toSessionScaledScore(summary.percentCorrect, resultsTargets)
      : null;
  const certPass =
    scaledScore !== null && resultsTargets
      ? scaledScore >= resultsTargets.passingScore
      : false;

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <span className="brand-mark">CCA-F</span>
          <div>
            <h1>Claude Certified Architect</h1>
            <p>Practice exam — By AppUnik</p>
          </div>
        </div>
        {screen === 'quiz' && session && sessionTargets && (
          <div className="header-stats">
            <span
              className={`mono exam-timer ${remainingSeconds <= 300 ? 'timer-low' : ''}`}
              title={`Time limit for ${session.totalQuestions} questions`}
            >
              {formatRemainingTime(remainingSeconds)} /{' '}
              {formatRemainingTime(sessionTargets.timeLimitSeconds)}
            </span>
            <span className="mono">
              Q{index + 1}/{session.totalQuestions}
            </span>
          </div>
        )}
      </header>

      <main className="main">
        {error && <div className="banner error">{error}</div>}

        {screen === 'home' && (
          <section className="card home-card">
            <h2>Start a practice session</h2>
            <p className="muted">
              Official CCA-F format: multiple choice (1 correct, 3 distractors). Full exam is{' '}
              {meta?.totalQuestions ?? 60} questions, <strong>2:00:00</strong>, pass{' '}
              {meta?.passingScore ?? 720}/{meta?.scoreMax ?? 1000} scaled. Your selection below
              scales time and pass targets proportionally.
            </p>

            {meta && (
              <>
                <details className="exam-guide">
                  <summary>Exam guide summary (from Anthropic materials)</summary>
                  <p className="hint">{meta.responseFormat}</p>
                  <p className="hint">{meta.examScenariosNote}</p>
                  <ul className="domain-list">
                    {meta.sections.map((d) => (
                      <li key={d.id}>
                        <strong>{d.name}</strong> <em className="muted">({d.range})</em>
                      </li>
                    ))}
                  </ul>
                  {meta.scenarios && meta.scenarios.length > 0 && (
                    <>
                      <p className="hint">Six exam scenarios (4 shown per attempt on the real exam):</p>
                      <ol className="scenario-list">
                        {meta.scenarios.map((s) => (
                          <li key={s.id}>
                            {s.name}
                          </li>
                        ))}
                      </ol>
                    </>
                  )}
                </details>
                <fieldset className="sections source-mode">
                  <legend>Question source</legend>
                  <label className="checkbox">
                    <input
                      type="radio"
                      name="source"
                      checked={!useAiMode}
                      onChange={() => {
                        setUseAiMode(false);
                        if (meta) setQuestionCount((c) => Math.min(c, meta.totalQuestions));
                      }}
                    />
                    <span>
                      <strong>JSON bank</strong> — random pick from 60 saved questions (fast)
                    </span>
                  </label>
                  <label className="checkbox">
                    <input
                      type="radio"
                      name="source"
                      checked={useAiMode}
                      onChange={() => {
                        setUseAiMode(true);
                        if (meta) setQuestionCount((c) => Math.min(c, meta.maxQuestionsPerSession));
                      }}
                      disabled={!meta.aiGenerationAvailable}
                    />
                    <span>
                      <strong>AI from learning URL</strong> — Claude writes new questions each
                      session
                      {!meta.aiGenerationAvailable && (
                        <em className="muted"> (set ANTHROPIC_API_KEY on the API)</em>
                      )}
                    </span>
                  </label>
                </fieldset>

                {useAiMode && (
                  <label className="field">
                    <span>Learning material URL</span>
                    <input
                      type="url"
                      className="url-input"
                      value={learningUrl}
                      onChange={(e) => setLearningUrl(e.target.value)}
                      placeholder="https://..."
                    />
                    <p className="hint">
                      The API fetches this page and Claude generates exam-style questions from the
                      content. First session may take 30–90 seconds.
                    </p>
                  </label>
                )}

                <label className="field">
                  <span>
                    Number of questions{' '}
                    {useAiMode ? '(generated fresh)' : '(random order from bank)'}
                  </span>
                  <input
                    type="range"
                    min={5}
                    max={useAiMode ? meta.maxQuestionsPerSession : meta.totalQuestions}
                    value={questionCount}
                    onChange={(e) => setQuestionCount(Number(e.target.value))}
                  />
                  <strong className="mono">{questionCount}</strong>
                </label>

                {previewTargets && (
                  <p className="session-targets hint">
                    For <strong>{previewTargets.questionCount}</strong> questions: time limit{' '}
                    <strong className="mono">
                      {formatRemainingTime(previewTargets.timeLimitSeconds)}
                    </strong>
                    , pass <strong>{previewTargets.passingScore}</strong>/
                    {previewTargets.scoreMax} scaled (full exam: {meta.passingScore}/
                    {meta.scoreMax} in 2:00:00).
                  </p>
                )}

                <fieldset className="sections">
                  <legend>Filter by exam domain (optional)</legend>
                  {meta.sections.map((s) => (
                    <label key={s.id} className="checkbox">
                      <input
                        type="checkbox"
                        checked={selectedSections.includes(s.id)}
                        onChange={() => toggleSection(s.id)}
                      />
                      <span>
                        {s.name} <em className="muted">({s.range})</em>
                      </span>
                    </label>
                  ))}
                  <p className="hint">
                    {useAiMode
                      ? 'Optional topic focus for AI generation.'
                      : 'Leave all unchecked to pull from the full question bank.'}
                  </p>
                </fieldset>

                <button
                  className="btn primary"
                  onClick={startPractice}
                  disabled={
                    loading ||
                    !meta ||
                    (useAiMode && !learningUrl.trim()) ||
                    (useAiMode && !meta.aiGenerationAvailable)
                  }
                >
                  {loading
                    ? useAiMode
                      ? 'Generating questions with AI…'
                      : 'Starting…'
                    : useAiMode
                      ? 'Generate & start exam'
                      : 'Start exam'}
                </button>
              </>
            )}

            {!meta && !error && <p className="muted">Loading exam data…</p>}
          </section>
        )}

        {screen === 'quiz' && question && (
          <section className="card quiz-card">
            {sessionTargets && (
              <div className="quiz-timer-bar">
                <span className="muted">
                  Time remaining ({sessionTargets.questionCount} questions)
                </span>
                <span
                  className={`mono exam-timer ${remainingSeconds <= 300 ? 'timer-low' : ''}`}
                >
                  {formatRemainingTime(remainingSeconds)} /{' '}
                  {formatRemainingTime(sessionTargets.timeLimitSeconds)}
                </span>
              </div>
            )}
            <div className="question-meta">
              <span className="pill">{question.sectionName}</span>
              <span className="muted">{question.title}</span>
            </div>
            <h2 className="question-text">{question.text}</h2>

            <div className="options">
              {(['A', 'B', 'C', 'D'] as const).map((letter) => {
                const text = question.options[letter];
                if (!text) return null;
                const state = selectedLetter === letter ? 'selected' : '';
                return (
                  <button
                    key={letter}
                    className={`option ${state}`}
                    onClick={() => pickAnswer(letter)}
                    disabled={!!selectedLetter || loading}
                  >
                    <span className="letter">{letter}</span>
                    <span>{text}</span>
                  </button>
                );
              })}
            </div>

            {selectedLetter && (
              <div className="quiz-actions">
                <p className="hint">Answer saved. Results are shown after you finish the session.</p>
                <button className="btn primary" onClick={finishOrNext} disabled={loading}>
                  {index + 1 >= (session?.totalQuestions ?? 0) ? 'Finish & view results' : 'Next question'}
                </button>
              </div>
            )}

            <div className="progress">
              <div
                className="progress-bar"
                style={{
                  width: `${((index + (selectedLetter ? 1 : 0)) / (session?.totalQuestions ?? 1)) * 100}%`,
                }}
              />
            </div>
          </section>
        )}

        {screen === 'results' && summary && (
          <section className="card results-card">
            <h2>Session complete</h2>
            <div className={`score-ring ${certPass ? 'pass' : 'fail'}`}>
              <span className="score-value">{scaledScore ?? summary.percentCorrect}</span>
              <span className="score-label">
                {resultsTargets
                  ? certPass
                    ? `Scaled score — at/above ${resultsTargets.passingScore} pass (${resultsTargets.questionCount} questions)`
                    : `Below ${resultsTargets.passingScore} pass (${summary.percentCorrect}% correct)`
                  : `${summary.percentCorrect}% correct`}
              </span>
            </div>
            <ul className="stats">
              <li>
                <strong>{summary.correct}</strong> correct
              </li>
              <li>
                <strong>{summary.answered}</strong> answered
              </li>
              <li>
                <strong>{summary.total}</strong> in session
              </li>
            </ul>
            {meta && resultsTargets && (
              <p className="muted">
                Scaled score for this session: {resultsTargets.scoreMin}–{resultsTargets.scoreMax}{' '}
                (pass {resultsTargets.passingScore}). Full {meta.totalQuestions}-question exam:{' '}
                {meta.scoreMin}–{meta.scoreMax}, pass {meta.passingScore}, 2:00:00, practice target{' '}
                {meta.practicePassingScore}+.
              </p>
            )}

            {review.length > 0 && (
              <div className="review-section">
                <h3>Answer review</h3>
                <p className="hint">Your selection, the correct answer, and explanation for each question.</p>
                {review.map((item) => (
                  <details
                    key={item.index}
                    className={`review-item ${item.isCorrect ? 'review-ok' : 'review-bad'}`}
                  >
                    <summary>
                      <span className="review-qnum">Q{item.index + 1}</span>
                      <span className="review-title">{item.title}</span>
                      <span className={`review-badge ${item.isCorrect ? 'ok' : 'bad'}`}>
                        {item.isCorrect ? 'Correct' : 'Incorrect'}
                      </span>
                    </summary>
                    <div className="review-body">
                      <p className="pill">{item.sectionName}</p>
                      <p className="question-text">{item.text}</p>
                      <ul className="review-answers">
                        <li>
                          <strong>Your answer:</strong> {item.selectedAnswer} —{' '}
                          {item.options[item.selectedAnswer]}
                        </li>
                        <li>
                          <strong>Correct answer:</strong> {item.correctAnswer} —{' '}
                          {item.options[item.correctAnswer]}
                        </li>
                      </ul>
                      <p className="review-explanation">{item.explanation}</p>
                    </div>
                  </details>
                ))}
              </div>
            )}

            <button className="btn primary" onClick={restart}>
              New practice session
            </button>
          </section>
        )}
      </main>

      <footer className="footer">
        <span>JSON: 60-question practice bank · AI: generated from learning URL · 5 official domains</span>
        <span>API: .NET 8 · UI: React + Vite</span>
      </footer>
    </div>
  );
}

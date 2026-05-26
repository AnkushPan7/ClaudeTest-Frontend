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
import { FormatText } from './formatText';

type Screen = 'home' | 'quiz' | 'submit-review' | 'results';

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
  const [answersByIndex, setAnswersByIndex] = useState<Record<number, string>>({});
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
        setLearningUrl(m.learningUrl ?? m.learningUrls?.[0] ?? '');
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
      );
      setSession(s);
      setIndex(0);
      setSelectedLetter(null);
      setAnswersByIndex({});
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
    if (!session || loading) return;
    setSelectedLetter(letter);
    setAnswersByIndex((prev) => ({ ...prev, [index]: letter }));
    setLoading(true);
    try {
      await submitAnswer(session.sessionId, index, letter);
    } catch {
      setError('Failed to save answer.');
    } finally {
      setLoading(false);
    }
  };

  const navigateToQuestion = useCallback(
    async (targetIndex: number) => {
      if (!session) return;
      setLoading(true);
      setError(null);
      try {
        setIndex(targetIndex);
        setSelectedLetter(answersByIndex[targetIndex] ?? null);
        const q = await fetchQuestion(session.sessionId, targetIndex);
        setQuestion(q);
      } catch {
        setError('Failed to load question.');
      } finally {
        setLoading(false);
      }
    },
    [session, answersByIndex],
  );

  const goPrevious = () => {
    if (index <= 0) return;
    void navigateToQuestion(index - 1);
  };

  const goNext = () => {
    if (!session || index + 1 >= session.totalQuestions) return;
    void navigateToQuestion(index + 1);
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
      const sortedReview = [...rev.questions].sort((a, b) => a.index - b.index);
      if (sortedReview.length < sum.total) {
        setError(
          `Review shows ${sortedReview.length} of ${sum.total} questions. Restart the .NET backend and submit again.`,
        );
      }
      setSummary(sum);
      setReview(sortedReview);
      setScreen('results');
    } catch {
      setError('Failed to load results.');
    } finally {
      setLoading(false);
    }
  }, [session]);

  const proceedToSubmitReview = useCallback(() => {
    if (!session) return;
    setError(null);
    setScreen('submit-review');
  }, [session]);

  const goToQuestionFromReview = useCallback(
    (questionIndex: number) => {
      if (!session) return;
      setError(null);
      setScreen('quiz');
      if (index !== questionIndex) {
        void navigateToQuestion(questionIndex);
      }
    },
    [session, index, navigateToQuestion],
  );

  const backToExam = useCallback(() => {
    if (!session) return;
    goToQuestionFromReview(session.totalQuestions - 1);
  }, [session, goToQuestionFromReview]);

  const submitExam = useCallback(async () => {
    if (!session) return;
    await finishSession();
  }, [session, finishSession]);

  const finishSessionRef = useRef(finishSession);
  finishSessionRef.current = finishSession;

  useEffect(() => {
    if ((screen !== 'quiz' && screen !== 'submit-review') || !session) return;

    const tick = () => {
      setRemainingSeconds((prev) => Math.max(0, prev - 1));
    };

    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [screen, session?.sessionId]);

  useEffect(() => {
    if (
      (screen !== 'quiz' && screen !== 'submit-review') ||
      !session ||
      remainingSeconds > 0 ||
      timeUpHandled.current
    ) {
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
    setAnswersByIndex({});
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
    summary && resultsTargets && summary.answered > 0
      ? toSessionScaledScore(summary.percentCorrect, resultsTargets)
      : null;
  const certPass =
    scaledScore !== null && resultsTargets
      ? scaledScore >= resultsTargets.passingScore
      : false;
  const resultsScoreDisplay =
    summary && (summary.answered === 0 || summary.percentCorrect === 0)
      ? `${summary.percentCorrect}%`
      : String(scaledScore ?? summary?.percentCorrect ?? 0);

  const answeredCount = Object.keys(answersByIndex).length;
  const totalQuestions = session?.totalQuestions ?? 0;
  const unansweredCount = Math.max(0, totalQuestions - answeredCount);
  const isLastQuestion = session ? index + 1 >= session.totalQuestions : false;
  const showExamTimer = screen === 'quiz' || screen === 'submit-review';

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
        <div className="header-end">
          {showExamTimer && session && sessionTargets && (
            <div className="header-stats">
              <span
                className={`mono exam-timer ${remainingSeconds <= 300 ? 'timer-low' : ''}`}
                title={`Time limit for ${session.totalQuestions} questions`}
              >
                {formatRemainingTime(remainingSeconds)} /{' '}
                {formatRemainingTime(sessionTargets.timeLimitSeconds)}
              </span>
              {screen === 'quiz' && (
                <span className="mono">
                  Q{index + 1}/{session.totalQuestions}
                </span>
              )}
              {screen === 'submit-review' && <span className="muted">Submit review</span>}
            </div>
          )}
          <div className="header-logos">
            <img
              src="/logos/claude.png"
              alt="Claude Certified Architect"
              className="header-logo header-logo-claude"
            />
            <img
              src="/logos/appunik.png"
              alt="AppUnik"
              className="header-logo header-logo-appunik"
            />
          </div>
        </div>
      </header>

      <main className="main">
        {error && <div className="banner error">{error}</div>}

        {screen === 'home' && (
          <section className="card home-card">
            <h2>Start a new practice session</h2>
            <p className="muted">
              Official CCA-F format: multiple choice (1 correct, 3 distractors). Full exam is 60
              questions, <strong>2:00:00</strong>, pass {meta?.passingScore ?? 720}/
              {meta?.scoreMax ?? 1000} scaled. Your selection below scales time and pass targets
              proportionally.
            </p>

            {meta && (
              <>
                <details className="exam-guide">
                  <summary>Exam guide summary (from Anthropic materials)</summary>
                  <p className="hint">{meta.responseFormat}</p>
                  <p className="hint">{meta.examScenariosNote}</p>
                  <ul className="domain-list domain-list-grid">
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
                  <div className="source-options">
                    <label className="checkbox source-option">
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
                        <strong>Practice question bank</strong> — Source : Real Claude
                        certification program exam
                      </span>
                    </label>
                    <label className="checkbox source-option">
                      <input
                        type="radio"
                        name="source"
                        checked={useAiMode}
                        onChange={() => {
                          setUseAiMode(true);
                          if (meta)
                            setQuestionCount((c) => Math.min(c, meta.maxQuestionsPerSession));
                        }}
                        disabled={!meta.aiGenerationAvailable}
                      />
                      <span>
                        <strong>AI from learning URL</strong> — Claude writes new questions each
                        session
                        {!meta.aiGenerationAvailable && (
                          <em className="muted">
                            {' '}
                            (set ANTHROPIC_API_KEY or AnthropicApiKey in backend .env)
                          </em>
                        )}
                      </span>
                    </label>
                  </div>
                </fieldset>

                {meta.aiGenerationAvailable && (
                  <label className="field learning-url-field">
                    <span>Learning material URL</span>
                    <input
                      type="url"
                      className="url-input"
                      value={learningUrl}
                      disabled
                      readOnly
                      aria-readonly="true"
                    />
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

                <fieldset className="sections domain-mode">
                  <legend>Filter by exam domain (optional)</legend>
                  <div className="domain-options">
                    {meta.sections.map((s) => (
                      <label key={s.id} className="checkbox domain-option">
                        <input
                          type="checkbox"
                          checked={selectedSections.includes(s.id)}
                          onChange={() => toggleSection(s.id)}
                        />
                        <span>
                          <strong>{s.name}</strong>{' '}
                          <em className="muted">({s.range})</em>
                        </span>
                      </label>
                    ))}
                  </div>
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
            <h2 className="question-text">
              <FormatText text={question.text} />
            </h2>

            <div className="options" role="radiogroup" aria-label="Answer choices">
              {(['A', 'B', 'C', 'D'] as const).map((letter) => {
                const text = question.options[letter];
                if (!text) return null;
                const selected = selectedLetter === letter;
                return (
                  <button
                    key={letter}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    className={`option ${selected ? 'selected' : ''}`}
                    onClick={() => pickAnswer(letter)}
                    disabled={loading}
                  >
                    <span className="option-radio" aria-hidden="true" />
                    <span className="option-letter" aria-hidden="true">
                      {letter}
                    </span>
                    <span className="option-text">
                      <FormatText text={text} />
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="quiz-actions">
              <p className="hint">
                You can change your answer or revisit earlier questions until you proceed to submit.
                {answeredCount > 0 && (
                  <>
                    {' '}
                    <span className="mono">
                      {answeredCount}/{session?.totalQuestions ?? 0}
                    </span>{' '}
                    answered.
                  </>
                )}
              </p>
              <div className="quiz-nav">
                <button
                  type="button"
                  className="btn secondary"
                  onClick={goPrevious}
                  disabled={loading || index <= 0}
                >
                  Previous
                </button>
                {isLastQuestion ? (
                  <button
                    type="button"
                    className="btn primary"
                    onClick={proceedToSubmitReview}
                    disabled={loading}
                  >
                    Proceed to Submit Exam
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn primary"
                    onClick={goNext}
                    disabled={loading}
                  >
                    Next question
                  </button>
                )}
              </div>
            </div>

            <div className="progress">
              <div
                className="progress-bar"
                style={{
                  width: `${(answeredCount / (session?.totalQuestions ?? 1)) * 100}%`,
                }}
              />
            </div>
          </section>
        )}

        {screen === 'submit-review' && session && (
          <section className="card submit-review-card">
            <h2>Submit exam</h2>
            <p className="muted">
              Review your progress before final submission. You can go back to change answers.
            </p>
            {sessionTargets && (
              <div className="quiz-timer-bar">
                <span className="muted">Time remaining</span>
                <span
                  className={`mono exam-timer ${remainingSeconds <= 300 ? 'timer-low' : ''}`}
                >
                  {formatRemainingTime(remainingSeconds)} /{' '}
                  {formatRemainingTime(sessionTargets.timeLimitSeconds)}
                </span>
              </div>
            )}
            <ul className="stats submit-stats">
              <li>
                <strong>{totalQuestions}</strong>
                total questions
              </li>
              <li>
                <strong>{answeredCount}</strong>
                answered
              </li>
              <li>
                <strong className={unansweredCount > 0 ? 'stat-warn' : ''}>
                  {unansweredCount}
                </strong>
                unanswered
              </li>
            </ul>
            {unansweredCount > 0 && (
              <p className="hint submit-warn">
                You have {unansweredCount} unanswered question
                {unansweredCount === 1 ? '' : 's'}. Unanswered questions count as incorrect.
              </p>
            )}
            <div className="question-palette">
              <p className="hint">Click a number to go to that question.</p>
              <div className="question-palette-grid" role="navigation" aria-label="Question list">
                {Array.from({ length: totalQuestions }, (_, i) => {
                  const answered = answersByIndex[i] != null;
                  return (
                    <button
                      key={i}
                      type="button"
                      className={`palette-box ${answered ? 'answered' : 'unanswered'}`}
                      onClick={() => goToQuestionFromReview(i)}
                      disabled={loading}
                      title={
                        answered
                          ? `Question ${i + 1} — answered`
                          : `Question ${i + 1} — unanswered`
                      }
                      aria-label={
                        answered
                          ? `Question ${i + 1}, answered`
                          : `Question ${i + 1}, unanswered`
                      }
                    >
                      {i + 1}
                    </button>
                  );
                })}
              </div>
              <p className="palette-legend hint">
                <span className="legend-swatch answered" /> Answered
                <span className="legend-swatch unanswered" /> Unanswered
              </p>
            </div>
            <div className="submit-review-actions">
              <button
                type="button"
                className="btn secondary"
                onClick={backToExam}
                disabled={loading}
              >
                Back to exam
              </button>
              <button
                type="button"
                className="btn primary"
                onClick={() => void submitExam()}
                disabled={loading}
              >
                {loading ? 'Submitting…' : 'Submit exam'}
              </button>
            </div>
          </section>
        )}

        {screen === 'results' && summary && (
          <section className="card results-card">
            <h2>Session complete</h2>
            <div className={`score-ring ${certPass ? 'pass' : 'fail'}`}>
              <span className="score-value">{resultsScoreDisplay}</span>
              <span className="score-label">
                {summary.answered === 0
                  ? 'No answers submitted — unanswered questions count as incorrect'
                  : resultsTargets && scaledScore != null
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
                <p className="hint">
                  All questions in your session — answered, unanswered, correct, and incorrect.
                </p>
                {review.map((item) => {
                  const statusClass = !item.answered
                    ? 'unanswered'
                    : item.isCorrect
                      ? 'ok'
                      : 'bad';
                  const statusLabel = !item.answered
                    ? 'Unanswered'
                    : item.isCorrect
                      ? 'Correct'
                      : 'Incorrect';
                  const itemClass = !item.answered
                    ? 'review-unanswered'
                    : item.isCorrect
                      ? 'review-ok'
                      : 'review-bad';

                  return (
                    <details key={item.index} className={`review-item ${itemClass}`}>
                      <summary>
                        <span className="review-qnum">Q{item.index + 1}</span>
                        <span className="review-title">{item.title}</span>
                        <span className={`review-badge ${statusClass}`}>{statusLabel}</span>
                      </summary>
                      <div className="review-body">
                        <p className="pill">{item.sectionName}</p>
                        <p className="question-text">
                          <FormatText text={item.text} />
                        </p>
                        <ul className="review-options">
                          {(['A', 'B', 'C', 'D'] as const).map((letter) => {
                            const optText = item.options[letter];
                            if (!optText) return null;
                            const isSelected = item.selectedAnswer === letter;
                            const isCorrect = item.correctAnswer === letter;
                            const state = isCorrect
                              ? 'correct'
                              : isSelected && !item.isCorrect
                                ? 'wrong'
                                : isSelected
                                  ? 'selected'
                                  : '';
                            return (
                              <li
                                key={letter}
                                className={`review-option ${state}`}
                              >
                                <span className="option-radio" aria-hidden="true" />
                                <span className="option-letter" aria-hidden="true">
                                  {letter}
                                </span>
                                <span className="option-text">
                                  <FormatText text={optText} />
                                </span>
                              </li>
                            );
                          })}
                        </ul>
                        <p className="review-explanation">
                          <FormatText text={item.explanation} />
                        </p>
                      </div>
                    </details>
                  );
                })}
              </div>
            )}

            <div className="results-actions">
              <button className="btn primary" onClick={restart}>
                New practice session
              </button>
            </div>
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

import { useEffect, useState } from 'react';
import {
  BookOpen, Plus, Trash2, Pencil, ChevronRight, ChevronLeft, HelpCircle, CheckCircle2, XCircle, ListChecks, Save,
} from 'lucide-react';
import { api } from '../api/client';
import { useI18n } from '../utils/i18n';
import { useToast } from '../stores/Toast';
import { useAuth } from '../stores/auth';
import { Modal, ConfirmDialog, Badge, Spinner, EmptyState } from '../components/ui';
import { ApiError } from '../api/client';

interface QuizQuestion {
  id: string;
  question: string;
  options: string[];
  correctIndex: number;
  explanation?: string | null;
}

interface Lesson {
  id: string;
  title: string;
  content: string;
  order: number;
  _count?: { questions: number };
  questions?: QuizQuestion[];
  attempts?: { score: number; total: number; passed: boolean; createdAt: string }[];
}

interface Course {
  id: string;
  title: string;
  description?: string | null;
  createdAt: string;
  lessons: Lesson[];
}

interface QuizResult {
  score: number;
  total: number;
  passed: boolean;
}

function LessonDetail({
  lesson,
  onBack,
  isAdmin,
  onUpdated,
  onManageQuestions,
  onDeleteLesson,
}: {
  lesson: Lesson;
  onBack: () => void;
  isAdmin: boolean;
  onUpdated: () => void;
  onManageQuestions?: () => void;
  onDeleteLesson?: () => void;
}) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [showQuiz, setShowQuiz] = useState(false);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [result, setResult] = useState<QuizResult | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const questions = lesson.questions ?? [];

  const submitQuiz = async () => {
    if (Object.keys(answers).length < questions.length) {
      toast('error', 'Hãy trả lời tất cả câu hỏi trước khi nộp bài.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await api.post<QuizResult>(`/elearning/lessons/${lesson.id}/submit`, {
        answers: questions.map((q) => ({ questionId: q.id, selectedIndex: answers[q.id] })),
      });
      setResult(res);
      onUpdated();
    } catch (err) {
      toast('error', err instanceof ApiError ? err.message : 'Không nộp bài được.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="text-sm text-slate-500 hover:text-brand-600 inline-flex items-center gap-1 font-semibold">
        <ChevronLeft size={15} /> {t('common.back')}
      </button>
      <div className="card p-5 space-y-4">
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-lg font-extrabold text-slate-800 dark:text-slate-100">{lesson.title}</h2>
          {isAdmin && (
            <button className="p-1.5 text-slate-400 hover:text-rose-500 rounded-lg hover:bg-rose-50 shrink-0 dark:hover:bg-rose-500/10" onClick={onDeleteLesson}>
              <Trash2 size={15} />
            </button>
          )}
        </div>
        <div className="prose prose-sm max-w-none text-slate-600 dark:text-slate-300 whitespace-pre-wrap">{lesson.content}</div>
      </div>

      {questions.length > 0 && (
        <div className="card p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-700 flex items-center gap-2 dark:text-slate-200">
              <ListChecks size={16} className="text-brand-500" /> {t('elearning.questions')} ({questions.length})
            </h3>
            <button className="btn-secondary" onClick={() => { setShowQuiz(!showQuiz); setResult(null); }}>
              {showQuiz ? t('common.close') : t('elearning.view')}
            </button>
          </div>

          {showQuiz && !result && (
            <div className="space-y-5">
              {questions.map((q, qi) => (
                <div key={q.id} className="space-y-2">
                  <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                    {qi + 1}. {q.question}
                  </div>
                  <div className="space-y-1.5">
                    {q.options.map((opt, oi) => (
                      <label
                        key={oi}
                        className={`flex items-center gap-2.5 rounded-xl border px-3 py-2 text-sm cursor-pointer transition-colors ${
                          answers[q.id] === oi
                            ? 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300'
                            : 'border-slate-200 text-slate-600 hover:border-slate-300 dark:border-slate-700 dark:text-slate-300'
                        }`}
                      >
                        <input
                          type="radio"
                          name={q.id}
                          className="accent-brand-600"
                          checked={answers[q.id] === oi}
                          onChange={() => setAnswers((a) => ({ ...a, [q.id]: oi }))}
                        />
                        {opt}
                      </label>
                    ))}
                  </div>
                </div>
              ))}
              <button className="btn-primary" onClick={() => void submitQuiz()} disabled={submitting}>
                {submitting && <Spinner size={15} />} {t('common.save')}
              </button>
            </div>
          )}

          {result && (
            <div className={`rounded-2xl border p-5 text-center ${result.passed ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-500/30 dark:bg-emerald-500/10' : 'border-rose-200 bg-rose-50 dark:border-rose-500/30 dark:bg-rose-500/10'}`}>
              {result.passed ? <CheckCircle2 className="mx-auto text-emerald-500" size={36} /> : <XCircle className="mx-auto text-rose-500" size={36} />}
              <div className="mt-2 text-2xl font-extrabold text-slate-800 dark:text-slate-100">
                {result.score}/{result.total}
              </div>
              <div className="text-sm font-semibold mt-1">
                {result.passed ? t('elearning.quizPassed') : t('elearning.quizFailed')}
              </div>
              <button className="btn-secondary mt-4" onClick={() => setResult(null)}>
                {t('elearning.view')}
              </button>
            </div>
          )}

          {isAdmin && (
            <div className="flex items-center justify-between">
              <p className="text-xs text-slate-400">{t('elearning.questions')}: {questions.length}</p>
              <button className="btn-secondary" onClick={onManageQuestions}>
                <Pencil size={14} /> {t('elearning.addQuestion')}
              </button>
            </div>
          )}
        </div>
      )}

      {isAdmin && (lesson.attempts?.length ?? 0) > 0 && (
        <div className="card p-5">
          <h3 className="text-sm font-bold text-slate-700 mb-3 dark:text-slate-200">{t('elearning.attempts')}</h3>
          <div className="space-y-1.5">
            {lesson.attempts?.map((a, i) => (
              <div key={i} className="flex items-center gap-3 text-sm">
                <span className="font-bold text-slate-700 dark:text-slate-200">{a.score}/{a.total}</span>
                <Badge className={a.passed ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300' : 'bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300'}>
                  {a.passed ? t('elearning.quizPassed') : t('elearning.quizFailed')}
                </Badge>
                <span className="text-xs text-slate-400">{new Date(a.createdAt).toLocaleString('vi-VN')}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function ELearning() {
  const { t } = useI18n();
  const { toast } = useToast();
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';

  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<{ course: Course; lesson: Lesson | null } | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [courseForm, setCourseForm] = useState({ title: '', description: '' });
  const [lessonForm, setLessonForm] = useState({ title: '', content: '' });
  const [showLessonModal, setShowLessonModal] = useState(false);
  const [lessonCourseId, setLessonCourseId] = useState('');
  const [questionsDraft, setQuestionsDraft] = useState<Omit<QuizQuestion, 'id'>[]>([]);
  const [showQuestionsModal, setShowQuestionsModal] = useState(false);
  const [questionsLessonId, setQuestionsLessonId] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<{ kind: 'course' | 'lesson'; id: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try {
      const data = await api.get<Course[]>('/elearning/courses');
      setCourses(data);
    } catch {
      toast('error', 'Không tải được khóa học.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const openLesson = async (course: Course, lesson: Lesson) => {
    try {
      const full = await api.get<Course>(`/elearning/courses/${course.id}`);
      const l = full.lessons.find((x) => x.id === lesson.id);
      setSelected({ course: full, lesson: l ?? lesson });
    } catch {
      setSelected({ course, lesson });
    }
  };

  const createCourse = async () => {
    if (!courseForm.title.trim()) return;
    setSaving(true);
    try {
      await api.post('/elearning/courses', courseForm);
      setShowCreate(false);
      setCourseForm({ title: '', description: '' });
      toast('success', 'Đã tạo khóa học.');
      await load();
    } catch (err) {
      toast('error', err instanceof ApiError ? err.message : 'Tạo thất bại.');
    } finally {
      setSaving(false);
    }
  };

  const addLesson = async () => {
    if (!lessonForm.title.trim() || !lessonForm.content.trim()) return;
    setSaving(true);
    try {
      await api.post(`/elearning/courses/${lessonCourseId}/lessons`, lessonForm);
      setShowLessonModal(false);
      setLessonForm({ title: '', content: '' });
      toast('success', 'Đã thêm bài học.');
      if (selected?.course.id === lessonCourseId) openLesson(selected.course, selected.lesson!);
      else await load();
    } catch (err) {
      toast('error', err instanceof ApiError ? err.message : 'Thêm bài học thất bại.');
    } finally {
      setSaving(false);
    }
  };

  const saveQuestions = async () => {
    setSaving(true);
    try {
      const cleaned = questionsDraft
        .filter((q) => q.question.trim() && q.options.filter((o) => o.trim()).length >= 2)
        .map((q) => ({
          question: q.question.trim(),
          options: q.options.map((o) => o.trim()),
          correctIndex: q.correctIndex,
          explanation: q.explanation?.trim() || undefined,
        }));
      await api.put(`/elearning/lessons/${questionsLessonId}/questions`, { questions: cleaned });
      setShowQuestionsModal(false);
      setQuestionsDraft([]);
      toast('success', 'Đã lưu câu hỏi.');
      if (selected?.lesson?.id === questionsLessonId) {
        await openLesson(selected.course, selected.lesson);
      }
      await load();
    } catch (err) {
      toast('error', err instanceof ApiError ? err.message : 'Lưu câu hỏi thất bại.');
    } finally {
      setSaving(false);
    }
  };

  const doDelete = async () => {
    if (!deleteTarget) return;
    try {
      if (deleteTarget.kind === 'course') await api.delete(`/elearning/courses/${deleteTarget.id}`);
      else await api.delete(`/elearning/lessons/${deleteTarget.id}`);
      toast('success', 'Đã xóa.');
      if (deleteTarget.kind === 'course' && selected?.course.id === deleteTarget.id) setSelected(null);
      if (deleteTarget.kind === 'lesson' && selected?.lesson?.id === deleteTarget.id) setSelected(null);
      await load();
    } catch {
      toast('error', 'Xóa thất bại.');
    }
    setDeleteTarget(null);
  };

  const manageQuestions = (lesson: Lesson) => {
    setQuestionsLessonId(lesson.id);
    setQuestionsDraft(
      (lesson.questions ?? []).map((q) => ({
        question: q.question,
        options: q.options,
        correctIndex: q.correctIndex,
        explanation: q.explanation ?? '',
      })),
    );
    setShowQuestionsModal(true);
  };

  if (selected) {
    return (
      <LessonDetail
        key={selected.lesson?.id}
        lesson={selected.lesson!}
        isAdmin={isAdmin}
        onBack={() => setSelected(null)}
        onUpdated={() => selected.course.id && openLesson(selected.course, selected.lesson!)}
        onManageQuestions={isAdmin ? () => manageQuestions(selected.lesson!) : undefined}
        onDeleteLesson={isAdmin ? () => setDeleteTarget({ kind: 'lesson', id: selected.lesson!.id }) : undefined}
      />
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-extrabold text-slate-800 dark:text-slate-100">{t('elearning.title')}</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">{courses.length} {t('elearning.coursesCount', 'khóa học')}</p>
        </div>
        {isAdmin && (
          <button className="btn-primary" onClick={() => setShowCreate(true)}>
            <Plus size={15} /> {t('elearning.newCourse')}
          </button>
        )}
      </div>

      {loading ? (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="card p-5 h-32 animate-pulse bg-slate-100 dark:bg-slate-800" />
          ))}
        </div>
      ) : courses.length === 0 ? (
        <div className="card">
          <EmptyState title={t('elearning.noCourses')} />
        </div>
      ) : (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
          {courses.map((course) => (
            <div key={course.id} className="card p-5 flex flex-col gap-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="bg-brand-50 text-brand-600 rounded-xl p-2 shrink-0 dark:bg-brand-500/15 dark:text-brand-300">
                    <BookOpen size={18} />
                  </div>
                  <div className="min-w-0">
                    <div className="font-bold text-slate-800 truncate dark:text-slate-100">{course.title}</div>
                    <div className="text-[11px] text-slate-400 font-semibold">{course.lessons.length} {t('elearning.lessons')}</div>
                  </div>
                </div>
                {isAdmin && (
                  <div className="flex gap-1 shrink-0">
                    <button className="p-1.5 text-slate-400 hover:text-rose-500 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-500/10" onClick={() => setDeleteTarget({ kind: 'course', id: course.id })}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                )}
              </div>
              {course.description && (
                <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2">{course.description}</p>
              )}
              <div className="flex-1 space-y-1.5">
                {course.lessons.slice(0, 4).map((l) => (
                  <button
                    key={l.id}
                    onClick={() => void openLesson(course, l)}
                    className="w-full text-left flex items-center justify-between rounded-xl bg-slate-50 hover:bg-slate-100 px-3 py-2 text-sm text-slate-600 transition-colors dark:bg-slate-800/60 dark:text-slate-300 dark:hover:bg-slate-800"
                  >
                    <span className="truncate">{l.title}</span>
                    <ChevronRight size={14} className="text-slate-400 shrink-0" />
                  </button>
                ))}
              </div>
              {isAdmin && (
                <button className="btn-secondary w-full" onClick={() => { setLessonCourseId(course.id); setShowLessonModal(true); }}>
                  <Plus size={14} /> {t('elearning.addLesson')}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Tạo khóa học */}
      <Modal open={showCreate} onClose={() => setShowCreate(false)} title={t('elearning.newCourse')}
        footer={
          <>
            <button className="btn-secondary" onClick={() => setShowCreate(false)}>{t('common.cancel')}</button>
            <button className="btn-primary" onClick={() => void createCourse()} disabled={saving || !courseForm.title.trim()}>
              {saving && <Spinner size={15} />} {t('common.confirm')}
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <div>
            <label className="label">{t('elearning.courseTitle')}</label>
            <input className="input" value={courseForm.title} onChange={(e) => setCourseForm({ ...courseForm, title: e.target.value })} />
          </div>
          <div>
            <label className="label">{t('elearning.description')}</label>
            <textarea className="input min-h-20" value={courseForm.description} onChange={(e) => setCourseForm({ ...courseForm, description: e.target.value })} />
          </div>
        </div>
      </Modal>

      {/* Thêm bài học */}
      <Modal open={showLessonModal} onClose={() => setShowLessonModal(false)} title={t('elearning.addLesson')}
        footer={
          <>
            <button className="btn-secondary" onClick={() => setShowLessonModal(false)}>{t('common.cancel')}</button>
            <button className="btn-primary" onClick={() => void addLesson()} disabled={saving || !lessonForm.title.trim() || !lessonForm.content.trim()}>
              {saving && <Spinner size={15} />} {t('common.save')}
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <div>
            <label className="label">{t('elearning.lessonTitle')}</label>
            <input className="input" value={lessonForm.title} onChange={(e) => setLessonForm({ ...lessonForm, title: e.target.value })} />
          </div>
          <div>
            <label className="label">{t('elearning.content')}</label>
            <textarea className="input min-h-32" value={lessonForm.content} onChange={(e) => setLessonForm({ ...lessonForm, content: e.target.value })} />
          </div>
        </div>
      </Modal>

      {/* Câu hỏi quiz */}
      <Modal open={showQuestionsModal} onClose={() => setShowQuestionsModal(false)} title={t('elearning.questions')} width="max-w-3xl"
        footer={
          <>
            <button className="btn-secondary" onClick={() => setShowQuestionsModal(false)}>{t('common.cancel')}</button>
            <button className="btn-primary" onClick={() => void saveQuestions()} disabled={saving}>
              {saving && <Spinner size={15} />} {t('elearning.saveQuestions')}
            </button>
          </>
        }
      >
        <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
          {questionsDraft.length === 0 && (
            <p className="text-sm text-slate-400 text-center py-6">Chưa có câu hỏi — bấm "Thêm câu hỏi" để bắt đầu.</p>
          )}
          {questionsDraft.map((q, qi) => (
            <div key={qi} className="rounded-2xl border border-slate-200 dark:border-slate-700 p-4 space-y-3">
              <div className="flex items-center gap-2">
                <HelpCircle size={15} className="text-brand-500" />
                <input
                  className="input flex-1"
                  placeholder={`${t('elearning.question')} ${qi + 1}`}
                  value={q.question}
                  onChange={(e) => setQuestionsDraft((d) => d.map((x, i) => (i === qi ? { ...x, question: e.target.value } : x)))}
                />
                <button className="text-slate-400 hover:text-rose-500" onClick={() => setQuestionsDraft((d) => d.filter((_, i) => i !== qi))}>
                  <Trash2 size={15} />
                </button>
              </div>
              <div className="space-y-1.5">
                {q.options.map((opt, oi) => (
                  <div key={oi} className="flex items-center gap-2">
                    <input
                      type="radio"
                      className="accent-brand-600 shrink-0"
                      checked={q.correctIndex === oi}
                      onChange={() => setQuestionsDraft((d) => d.map((x, i) => (i === qi ? { ...x, correctIndex: oi } : x)))}
                    />
                    <input
                      className="input flex-1"
                      placeholder={`${t('elearning.option')} ${oi + 1}`}
                      value={opt}
                      onChange={(e) => setQuestionsDraft((d) => d.map((x, i) => (i === qi ? { ...x, options: x.options.map((o, oi2) => (oi2 === oi ? e.target.value : o)) } : x)))}
                    />
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <input
                  className="input flex-1"
                  placeholder={t('elearning.explanation')}
                  value={q.explanation ?? ''}
                  onChange={(e) => setQuestionsDraft((d) => d.map((x, i) => (i === qi ? { ...x, explanation: e.target.value } : x)))}
                />
                <button className="btn-secondary shrink-0" onClick={() => setQuestionsDraft((d) => d.map((x, i) => (i === qi ? { ...x, options: [...x.options, ''] } : x)))}>
                  <Plus size={14} /> {t('elearning.option')}
                </button>
              </div>
            </div>
          ))}
          <button className="btn-secondary w-full" onClick={() => setQuestionsDraft((d) => [...d, { question: '', options: ['', '', ''], correctIndex: 0, explanation: '' }])}>
            <Plus size={14} /> {t('elearning.addQuestion')}
          </button>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => void doDelete()}
        title={deleteTarget?.kind === 'course' ? 'Xóa khóa học' : 'Xóa bài học'}
        message={`Bạn có chắc muốn xóa ${deleteTarget?.kind === 'course' ? 'khóa học' : 'bài học'} này?`}
        confirmLabel={t('common.delete')}
        danger
      />
    </div>
  );
}
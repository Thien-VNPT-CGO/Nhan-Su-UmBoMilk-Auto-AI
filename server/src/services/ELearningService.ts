import { prisma } from '../lib/prisma';
import { nextId } from '../lib/id';
import { ApiError } from '../lib/errors';
import { audit } from './AuditService';
import { emit } from '../sockets';
import { notificationService } from './NotificationService';

interface QuizAnswer {
  questionId: string;
  selectedIndex: number;
}

/** E-learning: khóa học, bài học, quiz kiểm tra cuối bài. */
export class ELearningService {
  async listCourses() {
    return prisma.course.findMany({
      orderBy: { createdAt: 'desc' },
      include: { lessons: { orderBy: { order: 'asc' }, include: { _count: { select: { questions: true } } } } },
    });
  }

  async getCourse(courseId: string) {
    const course = await prisma.course.findUnique({
      where: { id: courseId },
      include: {
        lessons: {
          orderBy: { order: 'asc' },
          include: { questions: true, attempts: { orderBy: { createdAt: 'desc' }, take: 5 } },
        },
      },
    });
    if (!course) throw ApiError.notFound('COURSE_NOT_FOUND', 'Không tìm thấy khóa học.');
    return course;
  }

  async createCourse(input: { title: string; description?: string }, user: string) {
    const course = await prisma.course.create({
      data: { id: nextId('CRS'), title: input.title, description: input.description ?? null },
    });
    await audit({ user, action: 'CREATE_COURSE', entity: 'course', entityId: course.id, newValue: input });
    emit('elearning:updated', { courseId: course.id });
    return course;
  }

  async updateCourse(courseId: string, input: { title?: string; description?: string }, user: string) {
    const course = await prisma.course.update({
      where: { id: courseId },
      data: { title: input.title, description: input.description },
    });
    await audit({ user, action: 'UPDATE_COURSE', entity: 'course', entityId: courseId, newValue: input });
    emit('elearning:updated', { courseId });
    return course;
  }

  async deleteCourse(courseId: string, user: string) {
    await prisma.course.delete({ where: { id: courseId } });
    await audit({ user, action: 'DELETE_COURSE', entity: 'course', entityId: courseId });
    emit('elearning:updated', { courseId });
  }

  async addLesson(courseId: string, input: { title: string; content: string }, user: string) {
    const course = await prisma.course.findUnique({ where: { id: courseId } });
    if (!course) throw ApiError.notFound('COURSE_NOT_FOUND', 'Không tìm thấy khóa học.');
    const max = await prisma.lesson.aggregate({
      where: { courseId },
      _max: { order: true },
    });
    const lesson = await prisma.lesson.create({
      data: {
        id: nextId('LSN'),
        courseId,
        title: input.title,
        content: input.content,
        order: (max._max.order ?? 0) + 1,
      },
    });
    await audit({ user, action: 'CREATE_LESSON', entity: 'lesson', entityId: lesson.id, newValue: input });
    emit('elearning:updated', { courseId });
    return lesson;
  }

  async updateLesson(lessonId: string, input: { title?: string; content?: string }, user: string) {
    const lesson = await prisma.lesson.update({
      where: { id: lessonId },
      data: { title: input.title, content: input.content },
    });
    await audit({ user, action: 'UPDATE_LESSON', entity: 'lesson', entityId: lessonId, newValue: input });
    emit('elearning:updated', { courseId: lesson.courseId });
    return lesson;
  }

  async deleteLesson(lessonId: string, user: string) {
    const lesson = await prisma.lesson.delete({ where: { id: lessonId } });
    await audit({ user, action: 'DELETE_LESSON', entity: 'lesson', entityId: lessonId });
    emit('elearning:updated', { courseId: lesson.courseId });
  }

  /** Thay cả bộ câu hỏi của 1 bài học (xóa cũ, tạo mới). */
  async saveQuestions(lessonId: string, questions: { question: string; options: string[]; correctIndex: number; explanation?: string }[], user: string) {
    const lesson = await prisma.lesson.findUnique({ where: { id: lessonId } });
    if (!lesson) throw ApiError.notFound('LESSON_NOT_FOUND', 'Không tìm thấy bài học.');
    await prisma.quizQuestion.deleteMany({ where: { lessonId } });
    await prisma.quizQuestion.createMany({
      data: questions.map((q) => ({
        id: nextId('QS'),
        lessonId,
        question: q.question,
        options: q.options,
        correctIndex: q.correctIndex,
        explanation: q.explanation ?? null,
      })),
    });
    await audit({ user, action: 'SAVE_QUESTIONS', entity: 'lesson', entityId: lessonId, newValue: { count: questions.length } });
    emit('elearning:updated', { courseId: lesson.courseId });
    return { saved: questions.length };
  }

  /** Nộp bài quiz: chấm điểm, lưu lịch sử, thông báo nếu ứng viên PASS. */
  async submitQuiz(
    lessonId: string,
    candidateId: string | null,
    answers: QuizAnswer[],
    user: string,
  ): Promise<{ score: number; total: number; passed: boolean; attemptId: string }> {
    const lesson = await prisma.lesson.findUnique({
      where: { id: lessonId },
      include: { questions: true },
    });
    if (!lesson) throw ApiError.notFound('LESSON_NOT_FOUND', 'Không tìm thấy bài học.');
    if (lesson.questions.length === 0) throw ApiError.badRequest('NO_QUESTIONS', 'Bài học chưa có câu hỏi.');

    const byId = new Map(lesson.questions.map((q) => [q.id, q]));
    let score = 0;
    for (const a of answers) {
      const q = byId.get(a.questionId);
      if (q && a.selectedIndex === q.correctIndex) score++;
    }
    const total = lesson.questions.length;
    const passed = score >= Math.ceil(total / 2);

    const attempt = await prisma.quizAttempt.create({
      data: {
        id: nextId('QAT'),
        lessonId,
        candidateId,
        score,
        total,
        passed,
        answers: answers as unknown as object,
      },
    });

    await audit({
      user,
      action: 'QUIZ_ATTEMPT',
      entity: 'lesson',
      entityId: lessonId,
      newValue: { candidateId, score, total, passed },
    });

    if (candidateId && passed) {
      await notificationService
        .notify({
          role: 'HR',
          title: 'Quiz hoàn thành',
          body: `Ứng viên ${candidateId} vừa đạt bài kiểm tra "${lesson.title}" (${score}/${total}).`,
          type: 'SUCCESS',
          link: '/training',
        })
        .catch(() => undefined);
    }
    emit('elearning:attempt', { lessonId, candidateId, score, total, passed });
    return { score, total, passed, attemptId: attempt.id };
  }

  /** Tiến trình quiz của ứng viên (bài đã làm + kết quả). */
  async progress(candidateId?: string) {
    const where = candidateId ? { candidateId } : {};
    const attempts = await prisma.quizAttempt.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { lesson: { select: { id: true, title: true, courseId: true } } },
    });
    return attempts;
  }
}

export const elearningService = new ELearningService();
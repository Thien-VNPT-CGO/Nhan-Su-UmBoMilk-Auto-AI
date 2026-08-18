import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole, AuthedRequest } from '../middleware/auth';
import { elearningService } from '../services/ELearningService';
import { ApiError } from '../lib/errors';

const router = Router();
router.use(requireAuth);

router.get('/courses', async (_req, res, next) => {
  try {
    const data = await elearningService.listCourses();
    res.json({ success: true, data });
  } catch (e) {
    next(e);
  }
});

router.get('/courses/:id', async (req, res, next) => {
  try {
    const data = await elearningService.getCourse(String(req.params.id));
    res.json({ success: true, data });
  } catch (e) {
    next(e);
  }
});

const courseSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
});

router.post('/courses', requireRole('ADMIN'), async (req: AuthedRequest, res, next) => {
  try {
    const parsed = courseSchema.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest('INVALID_INPUT', 'Dữ liệu không hợp lệ.');
    const data = await elearningService.createCourse(parsed.data, req.user!.username);
    res.json({ success: true, data });
  } catch (e) {
    next(e);
  }
});

router.patch('/courses/:id', requireRole('ADMIN'), async (req: AuthedRequest, res, next) => {
  try {
    const parsed = courseSchema.partial().safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest('INVALID_INPUT', 'Dữ liệu không hợp lệ.');
    const data = await elearningService.updateCourse(String(req.params.id), parsed.data, req.user!.username);
    res.json({ success: true, data });
  } catch (e) {
    next(e);
  }
});

router.delete('/courses/:id', requireRole('ADMIN'), async (req: AuthedRequest, res, next) => {
  try {
    await elearningService.deleteCourse(String(req.params.id), req.user!.username);
    res.json({ success: true });
  } catch (e) {
    next(e);
  }
});

const lessonSchema = z.object({
  title: z.string().min(1),
  content: z.string().min(1),
});

router.post('/courses/:id/lessons', requireRole('ADMIN'), async (req: AuthedRequest, res, next) => {
  try {
    const parsed = lessonSchema.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest('INVALID_INPUT', 'Dữ liệu không hợp lệ.');
    const data = await elearningService.addLesson(String(req.params.id), parsed.data, req.user!.username);
    res.json({ success: true, data });
  } catch (e) {
    next(e);
  }
});

router.patch('/lessons/:id', requireRole('ADMIN'), async (req: AuthedRequest, res, next) => {
  try {
    const parsed = lessonSchema.partial().safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest('INVALID_INPUT', 'Dữ liệu không hợp lệ.');
    const data = await elearningService.updateLesson(String(req.params.id), parsed.data, req.user!.username);
    res.json({ success: true, data });
  } catch (e) {
    next(e);
  }
});

router.delete('/lessons/:id', requireRole('ADMIN'), async (req: AuthedRequest, res, next) => {
  try {
    await elearningService.deleteLesson(String(req.params.id), req.user!.username);
    res.json({ success: true });
  } catch (e) {
    next(e);
  }
});

const questionsSchema = z.object({
  questions: z.array(
    z.object({
      question: z.string().min(1),
      options: z.array(z.string().min(1)).min(2),
      correctIndex: z.number().int().nonnegative(),
      explanation: z.string().optional(),
    }),
  ),
});

router.put('/lessons/:id/questions', requireRole('ADMIN'), async (req: AuthedRequest, res, next) => {
  try {
    const parsed = questionsSchema.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest('INVALID_INPUT', 'Dữ liệu câu hỏi không hợp lệ.');
    for (const q of parsed.data.questions) {
      if (q.correctIndex >= q.options.length) {
        throw ApiError.badRequest('INVALID_INPUT', 'Đáp án đúng phải nằm trong danh sách lựa chọn.');
      }
    }
    const data = await elearningService.saveQuestions(String(req.params.id), parsed.data.questions, req.user!.username);
    res.json({ success: true, data });
  } catch (e) {
    next(e);
  }
});

const submitSchema = z.object({
  candidateId: z.string().optional(),
  answers: z.array(
    z.object({
      questionId: z.string().min(1),
      selectedIndex: z.number().int().nonnegative(),
    }),
  ),
});

router.post('/lessons/:id/submit', requireRole('ADMIN', 'HR'), async (req: AuthedRequest, res, next) => {
  try {
    const parsed = submitSchema.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest('INVALID_INPUT', 'Dữ liệu nộp bài không hợp lệ.');
    const data = await elearningService.submitQuiz(
      String(req.params.id),
      parsed.data.candidateId ?? null,
      parsed.data.answers,
      req.user!.username,
    );
    res.json({ success: true, data });
  } catch (e) {
    next(e);
  }
});

router.get('/progress', async (req, res, next) => {
  try {
    const data = await elearningService.progress(req.query.candidateId ? String(req.query.candidateId) : undefined);
    res.json({ success: true, data });
  } catch (e) {
    next(e);
  }
});

export default router;
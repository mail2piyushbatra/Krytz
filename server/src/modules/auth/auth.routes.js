const express = require('express');
const { validate } = require('../../middleware/validate');
const { authenticate } = require('../../middleware/auth');
const { registerSchema, loginSchema, refreshSchema, forgotPasswordSchema, resetPasswordSchema, changePasswordSchema } = require('./auth.schema');
const authService = require('./auth.service');

const router = express.Router();

// POST /api/v1/auth/register
router.post('/register', validate(registerSchema), async (req, res, next) => {
  try {
    const result = await authService.register(req.body);
    res.status(201).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/auth/login
router.post('/login', validate(loginSchema), async (req, res, next) => {
  try {
    const result = await authService.login(req.body);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/auth/refresh
router.post('/refresh', validate(refreshSchema), async (req, res, next) => {
  try {
    const result = await authService.refresh(req.body.refreshToken);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/auth/forgot-password
router.post('/forgot-password', validate(forgotPasswordSchema), async (req, res, next) => {
  try {
    const result = await authService.forgotPassword(req.body.email);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/auth/reset-password
router.post('/reset-password', validate(resetPasswordSchema), async (req, res, next) => {
  try {
    const result = await authService.resetPassword(req.body.token, req.body.newPassword);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/auth/me
router.get('/me', authenticate, async (req, res, next) => {
  try {
    const user = await authService.getProfile(req.user.id);
    res.json({ success: true, data: { user } });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/v1/auth/me
router.patch('/me', authenticate, async (req, res, next) => {
  try {
    const user = await authService.updateProfile(req.user.id, req.body);
    res.json({ success: true, data: { user } });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/auth/change-password
router.post('/change-password', authenticate, validate(changePasswordSchema), async (req, res, next) => {
  try {
    const result = await authService.changePassword(req.user.id, req.body.currentPassword, req.body.newPassword);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/v1/auth/me
router.delete('/me', authenticate, async (req, res, next) => {
  try {
    const result = await authService.deleteAccount(req.user.id);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

// Vercel Function: every /api/* request goes to the NestJS backend. Nest is ESM-only and
// Vercel's loader can't require() ES modules, so the backend is bundled to one CommonJS file.
const { handler } = require('../backend/dist/serverless.bundle.js');

module.exports = (req, res) => handler(req, res);

// Vercel Function: every /api/* request goes to the NestJS backend (compiled to backend/dist).
const { handler } = require('../backend/dist/serverless');

module.exports = (req, res) => handler(req, res);

import type { DiffLine, ProposedChange, RunResult, RunScript } from './types';

const rateLimitCode = [
  'import type { RequestHandler } from "express";',
  'import { redis } from "../lib/redis";',
  '',
  'const WINDOW = 60; // seconds',
  'const LIMIT = 60;',
  '',
  'export const rateLimit: RequestHandler = async (req, res, next) => {',
  '  const key = `rate:${req.apiKey ?? req.ip}`;',
  '  const count = await redis.incr(key);',
  '  if (count === 1) await redis.expire(key, WINDOW);',
  '  res.set("RateLimit-Remaining", String(Math.max(0, LIMIT - count)));',
  '  if (count <= LIMIT) return next();',
  '  res.set("Retry-After", String(WINDOW));',
  '  res.status(429).json({ error: "Too many requests" });',
  '};',
];

const routeLines: DiffLine[] = [
  { type: 'ctx', old: 1, new: 1, text: 'import { Router } from "express";' },
  { type: 'ctx', old: 2, new: 2, text: 'import { requireApiKey } from "../middleware/auth";' },
  { type: 'add', new: 3, text: 'import { rateLimit } from "../middleware/rate-limit";' },
  { type: 'ctx', old: 3, new: 4, text: 'import { orders } from "./orders";' },
  { type: 'ctx', old: 4, new: 5, text: 'import { products } from "./products";' },
  { type: 'ctx', old: 5, new: 6, text: '' },
  { type: 'ctx', old: 6, new: 7, text: 'export const api = Router();' },
  { type: 'ctx', old: 7, new: 8, text: '' },
  { type: 'del', old: 8, text: 'api.use(requireApiKey);' },
  { type: 'add', new: 9, text: 'api.use(requireApiKey, rateLimit);' },
  { type: 'ctx', old: 9, new: 10, text: 'api.use("/orders", orders);' },
  { type: 'ctx', old: 10, new: 11, text: 'api.use("/products", products);' },
];

export const sampleResult: RunResult = {
  summary: 'Every /api route now goes through a Redis rate limiter: 60 requests a minute per API key, falling back to the IP. Responses carry RateLimit-Remaining, and a client over the limit gets a 429 with Retry-After. Types check and all 12 API tests pass.',
  files: [
    { path: 'src/middleware/rate-limit.ts', additions: 15, deletions: 0 },
    { path: 'src/api/routes.ts', additions: 2, deletions: 1 },
  ],
  tests: { passed: 12, total: 12 },
  checks: [{ label: 'No type errors', passed: true }],
};

export const sampleChange: ProposedChange = {
  id: 'rate-limit-v1',
  summary: 'Add a Redis rate limiter, 60 requests a minute per API key, and put it in front of every API route.',
  files: [
    {
      path: 'src/middleware/rate-limit.ts',
      status: 'added',
      lines: rateLimitCode.map((text, i) => ({ type: 'add', new: i + 1, text })),
    },
    { path: 'src/api/routes.ts', status: 'modified', lines: routeLines },
  ],
  outcome: sampleResult,
};

const revisedCode = rateLimitCode.map((line, i) => {
  if (i === 3) return 'const WINDOW = Number(process.env.RATE_LIMIT_WINDOW ?? 60);';
  if (i === 4) return 'const LIMIT = Number(process.env.RATE_LIMIT_MAX ?? 60);';
  if (i === 12) return '  res.set("Retry-After", String(Math.max(1, await redis.ttl(key))));';
  return line;
});

const revisedResult: RunResult = {
  ...sampleResult,
  summary: 'Added a configurable Redis rate limiter in front of every /api route. The default is 60 requests a minute per API key, with an IP fallback. RATE_LIMIT_MAX and RATE_LIMIT_WINDOW can override the defaults, and Retry-After uses the remaining window. Types check and all 12 API tests pass.',
};

const revisedChange: ProposedChange = {
  ...sampleChange,
  id: 'rate-limit-v2',
  summary: 'Make the limit and window configurable, keep the safe defaults, and return the remaining window in Retry-After.',
  files: [
    {
      ...sampleChange.files[0],
      lines: revisedCode.map((text, i) => ({ type: 'add', new: i + 1, text })),
    },
    sampleChange.files[1],
  ],
  outcome: revisedResult,
};

export const sampleScript: RunScript = {
  steps: [
    {
      id: 'plan', mark: 'think', verb: 'Planning the change', doneVerb: 'Planned the change', durationMs: 1200,
      text: 'I will inspect the API routes and existing Redis client, add a rate-limiting middleware, then check the types and run the API tests. I will ask for approval before writing any changes.',
    },
    {
      id: 'read-routes', mark: 'read', verb: 'Reading', doneVerb: 'Read', target: 'src/api/routes.ts', durationMs: 900,
      io: { input: 'read_file src/api/routes.ts', output: 'import { Router } from "express";\n...\nexport const api = Router();\napi.use(requireApiKey);\napi.use("/orders", orders);' },
    },
    {
      id: 'search-middleware', mark: 'search', verb: 'Searching for', doneVerb: 'Searched for', target: 'rate limit middleware', durationMs: 1000,
      io: { input: 'rg "rateLimit|rate.limit|throttle" src/', output: 'No existing rate-limiting middleware found.\nThe API router is mounted at /api in src/server.ts.' },
    },
    {
      id: 'read-package', mark: 'read', verb: 'Reading', doneVerb: 'Read', target: 'package.json', durationMs: 700,
      io: { input: 'read_file package.json', output: '{\n  "dependencies": { "express": "^5.1.0", "redis": "^5.0.0" },\n  "scripts": { "test": "vitest run", "typecheck": "tsc --noEmit" }\n}' },
    },
    {
      id: 'read-redis', mark: 'read', verb: 'Reading', doneVerb: 'Read', target: 'src/lib/redis.ts', durationMs: 700,
      io: { input: 'read_file src/lib/redis.ts', output: 'import { createClient } from "redis";\n\nexport const redis = createClient({ url: process.env.REDIS_URL });\nawait redis.connect();' },
    },
    {
      id: 'search-key', mark: 'search', verb: 'Searching for', doneVerb: 'Searched for', target: 'the API key on requests', durationMs: 900,
      io: { input: 'rg "apiKey" src/middleware src/types', output: 'src/middleware/auth.ts:12  req.apiKey = key.id;\nsrc/types/express.d.ts:4  apiKey?: string;\n\nThe authenticated API key is available before the routes run.' },
    },
    {
      id: 'review', mark: 'review', verb: 'Preparing', doneVerb: 'Approved', target: 'changes to 2 files', doneTarget: 'changes to 2 files', durationMs: 800,
      change: sampleChange,
      revise: [
        {
          id: 'revise', mark: 'think', verb: 'Revising the change', doneVerb: 'Revised the change', durationMs: 1800,
          text: 'This simulated revision makes the limit configurable and returns the remaining TTL. Your note is kept with the sent-back step.',
        },
        {
          id: 'review-revised', mark: 'review', verb: 'Preparing', doneVerb: 'Approved', target: 'revised changes to 2 files', doneTarget: 'revised changes to 2 files', durationMs: 800,
          change: revisedChange,
        },
      ],
    },
    {
      id: 'write-middleware', mark: 'edit', verb: 'Writing', doneVerb: 'Wrote', target: 'src/middleware/rate-limit.ts', durationMs: 900,
      io: { input: 'write_file src/middleware/rate-limit.ts', output: 'Created src/middleware/rate-limit.ts\n15 lines added.\n\nSimulated write. No real files were changed.' },
    },
    {
      id: 'edit-routes', mark: 'edit', verb: 'Editing', doneVerb: 'Edited', target: 'src/api/routes.ts', durationMs: 700,
      io: { input: 'apply_patch src/api/routes.ts', output: 'Imported rateLimit middleware.\nMounted after requireApiKey on every API route.\n2 lines added, 1 line removed.\n\nSimulated edit. No real files were changed.' },
    },
    {
      id: 'types', mark: 'typescript', verb: 'Checking types', doneVerb: 'Checked types', doneTarget: 'no errors', durationMs: 1100,
      io: { input: 'npx tsc --noEmit', output: 'Type check completed successfully.\nFound 0 errors.\n\nSimulated check.' },
    },
    {
      id: 'tests', mark: 'npm', verb: 'Running tests', doneVerb: 'Ran tests', doneTarget: '12 passed', durationMs: 2600,
      progress: { value: 0, total: 12 },
      io: { input: 'npm test -- --run src/api', output: 'PASS  src/api/__tests__/rate-limit.test.ts (6 tests)\nPASS  src/api/__tests__/orders.test.ts     (4 tests)\nPASS  src/api/__tests__/products.test.ts   (2 tests)\n\nTest Files  3 passed (3)\n     Tests  12 passed (12)\n\nSimulated test results.' },
    },
    {
      id: 'summary', mark: 'think', verb: 'Writing the summary', doneVerb: 'Wrote the summary', durationMs: 700,
      text: 'The approved changes are ready. All 12 API tests pass and TypeScript reports no errors. The run is ready for a pull request.',
    },
  ],
  result: sampleResult,
};
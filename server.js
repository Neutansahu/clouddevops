const express = require('express');
const crypto = require('crypto');
const path = require('path');

const PORT = process.env.PORT || 8000;
const SECRET = process.env.SESSION_SECRET || 'dev-secret-change-me';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@example.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const GH_REPO = process.env.GITHUB_REPO, GH_TOKEN = process.env.GITHUB_TOKEN;
const REGION = process.env.AWS_REGION || 'ap-south-1';
const ECR_REPO = process.env.ECR_REPOSITORY, APP = process.env.APP_NAME || 'cloud-devops-app';
const LIVE_GH = !!(GH_TOKEN && GH_REPO);
const LIVE_AWS = !!ECR_REPO;
const DAY = 864e5, HOUR = 36e5;

/* =============== demo data (used until GitHub / AWS variables are set) =============== */
function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(7);
const pick = (a) => a[Math.floor(rand() * a.length)];
const between = (a, b) => Math.round(a + rand() * (b - a));
const actors = ['asha', 'miguel', 'jonas', 'priya', 'kofi'];
const messages = ['Fix cart rounding error', 'Add health endpoint', 'Bump express to 4.21', 'Refactor auth middleware',
  'Tune container memory limit', 'Update dashboard copy', 'Add retry to payment client', 'Patch CVE in base image',
  'Cache product list', 'Handle SIGTERM gracefully', 'Add order export', 'Fix timezone in reports'];
const STAGES = ['test', 'build', 'staging', 'production'];
const SECS = { test: [40, 110], build: [70, 160], staging: [90, 200], production: [90, 200] };

let runNo = 168, nextId = 9000;
const runs = [];
let t = Date.now() - 25 * 60e3;
for (let i = 0; i < 48; i++) {
  const f = rand();
  const failAt = f < 0.08 ? 'test' : f < 0.13 ? 'build' : f < 0.19 ? 'staging' : f < 0.22 ? 'production' : null;
  let broken = false;
  const stages = STAGES.map((n) => {
    if (broken) return { name: n, status: 'skipped', sec: 0 };
    const sec = between(...SECS[n]);
    if (n === failAt) { broken = true; return { name: n, status: 'failed', sec: Math.round(sec / 2) }; }
    return { name: n, status: 'success', sec };
  });
  runs.push({
    id: nextId + 100 - i, number: runNo - i, sha: Math.floor(rand() * 0xfffffff).toString(16).padStart(7, '0'),
    message: pick(messages), branch: 'main', actor: pick(actors), event: 'push', startedAt: new Date(t).toISOString(),
    durationSec: stages.reduce((s, x) => s + x.sec, 0), status: failAt ? 'failed' : 'success', stages,
  });
  t -= between(2, 11) * HOUR;
}
nextId += 101;

const images = [];
runs.forEach((r) => {
  const get = (n) => r.stages.find((s) => s.name === n).status === 'success';
  if (get('build')) images.push({
    tag: r.sha, message: r.message, pushedAt: r.startedAt, sizeMb: +(112 + rand() * 14).toFixed(1),
    scan: { critical: rand() < 0.05 ? 1 : 0, high: between(0, 2), medium: between(0, 7) },
    deployedTo: { staging: get('staging'), production: get('production') },
  });
});
const ENVS = {
  staging: { name: 'staging', url: 'https://staging.example.com', desired: 1, running: 1, status: 'healthy' },
  production: { name: 'production', url: 'https://app.example.com', desired: 3, running: 3, status: 'healthy' },
};
for (const e of Object.keys(ENVS)) {
  const list = images.filter((i) => i.deployedTo[e]);
  Object.assign(ENVS[e], { tag: list[0].tag, previousTag: list[1] ? list[1].tag : null, deployedAt: list[0].pushedAt });
}
const activity = [];
const audit = (actor, action, detail, at = Date.now()) => activity.unshift({ at: new Date(at).toISOString(), actor, action, detail });
[['asha', 'deploy', 'Deployed ' + ENVS.production.tag + ' to production', 6 * HOUR],
 ['miguel', 'rollback', 'Rolled production back to ' + ENVS.production.previousTag, 30 * HOUR],
 ['system', 'alarm', 'CloudWatch alarm staging-cpu-high entered ALARM', 40 * HOUR],
 ['priya', 'login', 'Signed in', 52 * HOUR]].reverse()
  .forEach(([a, b, c, off]) => audit(a, b, c, Date.now() - off));

function simulateDeploy({ environment, tag, kind, actor }) {
  const env = ENVS[environment];
  env.status = 'deploying';
  const run = {
    id: nextId++, number: ++runNo, sha: tag, branch: 'main', actor, event: 'workflow_dispatch',
    message: `${kind === 'rollback' ? 'Roll back' : 'Deploy'} ${tag} to ${environment}`,
    startedAt: new Date().toISOString(), durationSec: 0, status: 'running',
    stages: [{ name: environment, status: 'running', sec: 0 }],
  };
  runs.unshift(run);
  setTimeout(() => {
    run.stages[0] = { name: environment, status: 'success', sec: 95 };
    run.durationSec = 95; run.status = 'success';
    env.previousTag = env.tag; env.tag = tag; env.deployedAt = new Date().toISOString(); env.status = 'healthy';
    const img = images.find((i) => i.tag === tag); if (img) img.deployedTo[environment] = true;
    audit('system', 'deploy', `${tag} is live on ${environment}`);
  }, 7000);
  return run;
}

function logsFor(run) {
  const steps = {
    test: ['npm ci', 'npm run lint', 'npm test'], build: ['docker buildx build --push', 'Pushed image to Amazon ECR', 'ECR scan started'],
    staging: ['Sign in to AWS with OIDC', 'Send SSM Run Command to tagged instances', 'Pull image from ECR and restart container', 'Health check on port 8000 passed'],
    production: ['Sign in to AWS with OIDC', 'Send SSM Run Command to tagged instances', 'Pull image from ECR and restart container', 'Health check on port 8000 passed'],
  };
  const out = [];
  run.stages.forEach((s) => {
    out.push(`::group:: ${s.name} (${s.status})`);
    if (s.status === 'skipped') { out.push('Skipped because an earlier stage failed.'); return; }
    (steps[s.name] || steps.production).forEach((l, i, a) => {
      if (s.status === 'failed' && i === a.length - 1) { out.push(`${l}: FAILED`, 'Error: Process completed with exit code 1.'); }
      else out.push(`${l}: ok`);
    });
    if (s.status === 'running') out.push('Waiting for the health check on port 8000...');
  });
  return out;
}

/* =============== live providers (GitHub Actions + AWS) =============== */
const gh = async (p, opt = {}) => {
  const r = await fetch('https://api.github.com' + p, { ...opt, headers: { Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + GH_TOKEN, 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'clouddevops', ...opt.headers } });
  if (!r.ok) throw new Error('GitHub API returned ' + r.status);
  return r.status === 204 ? null : r.json();
};
const mapState = (o) => o.status === 'completed'
  ? ({ success: 'success', failure: 'failed', cancelled: 'cancelled', skipped: 'skipped' }[o.conclusion] || 'failed')
  : o.status === 'in_progress' ? 'running' : 'queued';
const stageName = (n) => /staging/i.test(n) ? 'staging' : /production/i.test(n) ? 'production' : /build/i.test(n) ? 'build' : /test/i.test(n) ? 'test' : n;

async function liveRuns() {
  const d = await gh(`/repos/${GH_REPO}/actions/runs?per_page=30`);
  return Promise.all(d.workflow_runs.map(async (r, i) => {
    let stages = [];
    if (i < 15) {
      const j = await gh(`/repos/${GH_REPO}/actions/runs/${r.id}/jobs`);
      stages = j.jobs.map((x) => ({ name: stageName(x.name), status: mapState(x), sec: x.completed_at ? Math.round((Date.parse(x.completed_at) - Date.parse(x.started_at)) / 1000) : 0 }));
    }
    const start = r.run_started_at || r.created_at;
    return {
      id: r.id, number: r.run_number, sha: r.head_sha.slice(0, 7), message: ((r.head_commit || {}).message || r.display_title || '').split('\n')[0],
      branch: r.head_branch, actor: (r.actor || {}).login, event: r.event, startedAt: start, status: mapState(r), stages, url: r.html_url,
      durationSec: Math.round(((r.status === 'completed' ? Date.parse(r.updated_at) : Date.now()) - Date.parse(start)) / 1000),
    };
  }));
}
async function liveEnvs() {
  const { EC2Client, DescribeInstancesCommand } = require('@aws-sdk/client-ec2');
  const { SSMClient, GetParametersCommand } = require('@aws-sdk/client-ssm');
  const ec2 = new EC2Client({ region: REGION }), ssm = new SSMClient({ region: REGION }), out = {};
  for (const name of ['staging', 'production']) {
    const d = await ec2.send(new DescribeInstancesCommand({ Filters: [{ Name: 'tag:App', Values: [APP] }, { Name: 'tag:Env', Values: [name] }, { Name: 'instance-state-name', Values: ['running', 'pending'] }] }));
    const inst = d.Reservations.flatMap((r) => r.Instances), running = inst.filter((i) => i.State.Name === 'running').length;
    const pr = await ssm.send(new GetParametersCommand({ Names: ['image-tag', 'previous-tag', 'deployed-at'].map((k) => `/${APP}/${name}/${k}`) }));
    const v = (k) => (pr.Parameters.find((x) => x.Name.endsWith('/' + k)) || {}).Value || null;
    out[name] = { name, url: process.env['URL_' + name.toUpperCase()] || '', tag: v('image-tag') || 'none', previousTag: v('previous-tag'), deployedAt: v('deployed-at'),
      desired: inst.length, running, status: inst.length === 0 ? 'warning' : running < inst.length ? 'deploying' : 'healthy' };
  }
  return out;
}
async function liveImages(envs) {
  const { ECRClient, DescribeImagesCommand } = require('@aws-sdk/client-ecr');
  const d = await new ECRClient({ region: REGION }).send(new DescribeImagesCommand({ repositoryName: ECR_REPO, filter: { tagStatus: 'TAGGED' } }));
  const on = (n, tag) => envs[n].tag === tag || envs[n].previousTag === tag;
  return (d.imageDetails || []).filter((i) => i.imageTags && i.imageTags[0]).sort((a, b) => b.imagePushedAt - a.imagePushedAt).map((i) => {
    const tag = i.imageTags[0], f = (i.imageScanFindingsSummary || {}).findingSeverityCounts || {};
    return { tag, message: '', pushedAt: i.imagePushedAt.toISOString(), sizeMb: +(i.imageSizeInBytes / 1048576).toFixed(1),
      scan: { critical: f.CRITICAL || 0, high: f.HIGH || 0, medium: f.MEDIUM || 0 }, deployedTo: { staging: on('staging', tag) || on('production', tag), production: on('production', tag) } };
  });
}

let ghCache = { at: 0, data: null };
async function getRuns() {
  if (LIVE_GH) {
    try {
      if (Date.now() - ghCache.at > 20000) ghCache = { at: Date.now(), data: await liveRuns() };
      return { runs: ghCache.data, source: 'github' };
    } catch (e) { console.error(e.message); }
  }
  runs.forEach((r) => { if (r.status === 'running') r.durationSec = Math.round((Date.now() - Date.parse(r.startedAt)) / 1000); });
  return { runs, source: 'demo' };
}
async function getEnvs() {
  if (LIVE_AWS) { try { return await liveEnvs(); } catch (e) { console.error(e.message); } }
  return ENVS;
}
async function getImages(envs) {
  if (LIVE_AWS) { try { return await liveImages(envs); } catch (e) { console.error(e.message); } }
  return images;
}

/* =============== auth =============== */
const hmac = (b) => crypto.createHmac('sha256', SECRET).update(b).digest('base64url');
const sign = (p) => { const b = Buffer.from(JSON.stringify(p)).toString('base64url'); return `${b}.${hmac(b)}`; };
function verify(token) {
  try {
    const [b, s] = String(token || '').split('.'), e = hmac(b || '');
    if (!b || !s || s.length !== e.length || !crypto.timingSafeEqual(Buffer.from(s), Buffer.from(e))) return null;
    const p = JSON.parse(Buffer.from(b, 'base64url'));
    return p.exp > Date.now() ? p : null;
  } catch { return null; }
}
const auth = (req, res, next) => {
  const u = verify((req.headers.authorization || '').replace('Bearer ', ''));
  if (!u) return res.status(401).json({ error: 'Your session expired. Sign in again.' });
  req.user = u; next();
};
const wrap = (fn) => (req, res) => fn(req, res).catch((e) => res.status(500).json({ error: e.message }));

/* =============== app =============== */
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '10kb' }));
app.use((req, res, next) => { res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin' }); next(); });

app.get('/health', (req, res) => res.json({ status: 'ok', port: +PORT, uptime: Math.round(process.uptime()), memoryMb: Math.round(process.memoryUsage().rss / 1048576) }));

app.post('/api/login', (req, res) => {
  const { email, password } = req.body || {};
  const ok = email === ADMIN_EMAIL && typeof password === 'string' && password.length === ADMIN_PASSWORD.length &&
    crypto.timingSafeEqual(Buffer.from(password), Buffer.from(ADMIN_PASSWORD));
  if (!ok) return res.status(401).json({ error: 'Email or password is incorrect.' });
  audit(email.split('@')[0], 'login', 'Signed in');
  res.json({ token: sign({ email, exp: Date.now() + 8 * HOUR }) });
});

app.get('/api/config', auth, (req, res) => res.json({ github: LIVE_GH ? GH_REPO : null, aws: LIVE_AWS ? APP : null, region: REGION }));

app.get('/api/overview', auth, wrap(async (req, res) => {
  const { runs: rs } = await getRuns();
  const envs = await getEnvs();
  const since = Date.now() - 14 * DAY;
  const recent = rs.filter((r) => Date.parse(r.startedAt) >= since);
  const done = recent.filter((r) => ['success', 'failed'].includes(r.status));
  const ci = recent.filter((r) => r.status === 'success' && r.event === 'push').map((r) => r.durationSec).sort((a, b) => a - b);
  const perDay = Array.from({ length: 14 }, (_, i) => ({ date: new Date(Date.now() - (13 - i) * DAY).toISOString().slice(0, 10), success: 0, failed: 0 }));
  recent.forEach((r) => {
    const k = r.status === 'success' ? 'success' : r.status === 'failed' ? 'failed' : null;
    const d = perDay.find((x) => x.date === r.startedAt.slice(0, 10)); if (k && d) d[k]++;
  });
  res.json({
    envs, perDay, recent: rs.slice(0, 5),
    kpis: {
      deploys: recent.filter((r) => r.stages.some((s) => s.name === 'production' && s.status === 'success')).length,
      successRate: done.length ? Math.round(done.filter((r) => r.status === 'success').length / done.length * 100) : null,
      medianSec: ci.length ? ci[Math.floor(ci.length / 2)] : null,
      failed: recent.filter((r) => r.status === 'failed').length,
    },
  });
}));

app.get('/api/runs', auth, wrap(async (req, res) => {
  const { runs: rs } = await getRuns();
  const q = String(req.query.q || '').toLowerCase(), st = req.query.status || '';
  const list = rs.filter((r) => (!st || r.status === st) && (!q || `${r.number} ${r.sha} ${r.message} ${r.actor}`.toLowerCase().includes(q)));
  const pages = Math.max(1, Math.ceil(list.length / 10));
  const page = Math.min(pages, Math.max(1, parseInt(req.query.page, 10) || 1));
  res.json({ rows: list.slice((page - 1) * 10, page * 10), total: list.length, page, pages });
}));

app.get('/api/runs/:id', auth, wrap(async (req, res) => {
  const { runs: rs } = await getRuns();
  const run = rs.find((r) => r.id === +req.params.id);
  if (!run) return res.status(404).json({ error: 'Run not found.' });
  res.json({ run, logs: run.url ? null : logsFor(run) });
}));

app.get('/api/images', auth, wrap(async (req, res) => {
  const envs = await getEnvs();
  res.json({ images: (await getImages(envs)).slice(0, 25), envs });
}));

app.post('/api/deploy', auth, wrap(async (req, res) => {
  const { environment, tag, kind } = req.body || {};
  const envs = await getEnvs(), imgs = await getImages(envs), env = envs[environment], img = imgs.find((i) => i.tag === tag);
  if (!env) return res.status(400).json({ error: 'Choose staging or production.' });
  if (!img) return res.status(404).json({ error: 'That image tag is not in the registry.' });
  if (env.status === 'deploying') return res.status(409).json({ error: `A deployment to ${environment} is already running.` });
  if (kind === 'rollback' ? !img.deployedTo[environment] : environment === 'production' && !img.deployedTo.staging)
    return res.status(422).json({ error: kind === 'rollback' ? 'You can only roll back to an image that ran in this environment.' : 'Deploy this image to staging first. Production only accepts images that passed staging.' });
  const actor = req.user.email.split('@')[0];
  if (LIVE_GH) {
    await gh(`/repos/${GH_REPO}/actions/workflows/manual-deploy.yml/dispatches`, { method: 'POST', body: JSON.stringify({ ref: 'main', inputs: { environment, image_tag: tag } }) });
    ghCache.at = 0;
    audit(actor, kind || 'deploy', `Requested ${tag} on ${environment} via GitHub Actions`);
    return res.status(202).json({ message: 'Workflow started in GitHub Actions.' });
  }
  simulateDeploy({ environment, tag, kind, actor });
  audit(actor, kind || 'deploy', `Started ${kind === 'rollback' ? 'rollback to' : 'deploy of'} ${tag} on ${environment}`);
  res.status(202).json({ message: 'Deployment started (demo mode).' });
}));

app.get('/api/infra', auth, wrap(async (req, res) => {
  const envs = await getEnvs(), imgs = await getImages(envs), n = Date.now() / 6e4;
  const inst = (e) => `${envs[e].running}/${envs[e].desired} ${e} instance${envs[e].desired === 1 ? '' : 's'}`;
  if (LIVE_AWS) {
    return res.json({ metrics: null, services: [
      { name: 'Amazon ECR', detail: `${imgs.length} images in ${ECR_REPO}`, status: 'healthy' },
      { name: 'Amazon EC2 (Docker host)', detail: `${inst('staging')}, ${inst('production')}`, status: envs.staging.running && envs.production.running ? 'healthy' : 'warning' },
      { name: 'Systems Manager', detail: 'Run Command deploys and Session Manager shells, no open SSH port', status: 'healthy' },
      { name: 'GitHub OIDC role', detail: 'Short-lived credentials, no stored access keys', status: 'healthy' }] });
  }
  const s = (b, a, o, nz) => Array.from({ length: 30 }, (_, i) => +Math.max(1, b + a * Math.sin((n + i) / 5 + o) + Math.random() * nz).toFixed(1));
  res.json({
    services: [
      { name: 'Amazon ECR', detail: `${imgs.length} images in cloud-devops-app, scan on push enabled`, status: 'healthy' },
      { name: 'Amazon EC2 (Docker host)', detail: `${inst('staging')}, ${inst('production')}`, status: 'healthy' },
      { name: 'Systems Manager', detail: 'Run Command and Session Manager, no open SSH port', status: 'healthy' },
      { name: 'CloudWatch alarms', detail: '1 of 14 alarms firing: staging-cpu-high', status: 'warning' },
      { name: 'Secrets and Parameter Store', detail: 'Runtime secrets and release tags, none in the image', status: 'healthy' },
      { name: 'GitHub OIDC role', detail: 'Short-lived credentials, no stored access keys', status: 'healthy' }],
    metrics: { staging: { cpu: s(48, 22, 0, 6), mem: s(55, 6, 1, 3), p95: s(180, 40, 2, 20) }, production: { cpu: s(34, 14, 3, 5), mem: s(61, 5, 4, 3), p95: s(120, 25, 5, 15) } },
  });
}));

app.get('/api/activity', auth, (req, res) => res.json({ events: activity.slice(0, 40) }));

app.use(express.static(path.join(__dirname, 'public')));
app.use((req, res) => res.status(404).json({ error: 'Not found.' }));

const server = app.listen(PORT, () => console.log(`CloudDevOps listening on ${PORT} (GitHub: ${LIVE_GH ? 'live' : 'demo'}, AWS: ${LIVE_AWS ? 'live' : 'demo'})`));
process.on('SIGTERM', () => { console.log('SIGTERM received, draining'); server.close(() => process.exit(0)); });

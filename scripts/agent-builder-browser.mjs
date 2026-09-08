/** Actual Next.js + PostgreSQL browser checks; model discovery is intercepted and no generation is called. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { en, zhCN } from '../src/shared/i18n/messages.ts';

const base = process.env.BUILDER_BROWSER_BASE_URL;
assert(base, 'Set BUILDER_BROWSER_BASE_URL to the isolated local Next.js test server.');
const target = new URL(base);
assert(['localhost', '127.0.0.1'].includes(target.hostname) && target.port, 'Browser checks refuse remote or implicit-port targets.');
const modulePath = process.env.PLAYWRIGHT_MODULE;
const { chromium } = await import(modulePath ? pathToFileURL(resolve(modulePath)).href : 'playwright');
const output = resolve(process.env.BUILDER_BROWSER_OUTPUT ?? 'test-results/agent-builder');
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
const report = { checks: [], errors: [], mocked: ['model discovery response', 'run availability indicator'], real: ['Next.js UI', 'Better Auth', 'PostgreSQL', 'Skill import', 'Build version save/read'], generationCalls: 0 };
const mark = (name) => { report.checks.push(name); console.log(`PASS: ${name}`); };
let page;
const fakeKey = 'sk-browser-offline-not-a-real-provider-key';
async function eventually(check, description) {
  let last;
  for (let i = 0; i < 100; i++) {
    try { await check(); return; } catch (error) { last = error; }
    await new Promise((done) => setTimeout(done, 75));
  }
  throw new Error(description, { cause: last });
}
async function signup(name) {
  const response = await context.request.post(`${base}/api/auth/sign-up/email`, { headers: { Origin: base }, data: {
    name, email: `builder-${randomUUID()}@example.invalid`, password: `BrowserOnly!${randomUUID()}`,
  } });
  assert.equal(response.status(), 200, `Signup failed: ${response.status()}`);
  return (await response.json()).user.id;
}
try {
  const boot = await (await context.request.get(`${base}/api/arena/boot`)).json();
  assert.equal(boot.demoMode, true, 'Browser checks require explicit test mode.');
  const ownerId = await signup('Builder browser test');
  await context.addInitScript(() => {
    if (!localStorage.getItem('agentforge.display-language')) localStorage.setItem('agentforge.display-language', 'en');
  });
  const providers = await (await context.request.get(`${base}/api/arena/providers`)).json();
  assert.equal(providers.ownerId, ownerId);
  assert.ok(providers.allowedHosts.length);
  const providerUrl = `https://${providers.allowedHosts[0]}/v1/chat/completions`;
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== target.origin) return route.abort('blockedbyclient');
    if (url.pathname === '/api/arena/creation-runs' && route.request().method() === 'POST') {
      report.generationCalls++;
      return route.abort('blockedbyclient');
    }
    return route.continue();
  });
  await context.route('**/api/arena/animation-challenges', async (route) => {
    const response = await route.fetch();
    const challenges = await response.json();
    await route.fulfill({ response, json: challenges.map((challenge) => ({ ...challenge, runAvailability: { enabled: true, reason: 'enabled' } })) });
  });
  let discoveryCalls = 0;
  await context.route('**/api/arena/providers/models', async (route) => {
    assert.equal(route.request().method(), 'POST');
    assert.equal(route.request().postDataJSON().apiKey, fakeKey);
    discoveryCalls++;
    await route.fulfill({ json: { models: [{ id: 'builder-fast', name: 'Fast' }, { id: 'builder-quality', name: 'Quality' }], truncated: false } });
  });
  page = await context.newPage();
  page.on('pageerror', (error) => report.errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error' && /hydration|hydrating|react error/i.test(message.text())) report.errors.push(message.text()); });
  const label = (key, lang = en) => page.getByLabel(lang[key], { exact: true });
  const button = (key, lang = en) => page.getByRole('button', { name: lang[key], exact: true });
  await page.goto(`${base}/agent-builder`, { waitUntil: 'networkidle' });
  await eventually(async () => assert.equal(await label('artifactArena.buildName').isEnabled(), true), 'Builder did not finish loading.');
  await label('artifactArena.baseUrl').fill(providerUrl);
  await label('artifactArena.apiKey').fill(fakeKey);
  await button('builderPlus.discoverModels').click();
  await label('builderPlus.modelList').waitFor();
  await label('builderPlus.searchModels').fill('quality');
  await label('builderPlus.modelList').selectOption('builder-quality');
  assert.equal(await label('artifactArena.modelId').inputValue(), 'builder-quality');
  assert.equal(discoveryCalls, 1);
  mark('Fetch and search models before saving a credential');
  await label('artifactArena.credentialName').fill('Offline browser credential');
  const [savedResponse] = await Promise.all([
    page.waitForResponse((response) => response.url().endsWith('/api/arena/providers') && response.request().method() === 'POST'),
    button('artifactArena.saveCredential').click(),
  ]);
  assert.equal(savedResponse.status(), 201);
  const savedCredential = await savedResponse.json();
  assert.equal(savedCredential.modelId, 'builder-quality');
  assert.equal(savedCredential.baseUrl, `https://${providers.allowedHosts[0]}/v1`);
  await eventually(async () => assert.equal(await label('artifactArena.apiKey').inputValue(), ''), 'API key was not cleared.');
  assert.equal(JSON.stringify(savedCredential).includes(fakeKey), false);
  mark('Real encrypted credential save, normalized URL and cleared key field');

  await label('builderPlus.uploadSkill').setInputFiles({ name: 'unsafe.zip', mimeType: 'application/zip', buffer: Buffer.from('not a Skill') });
  await page.getByRole('alert').first().waitFor();
  assert.equal(await button('builderPlus.importSkill').count(), 0);
  const skillText = '---\nname: Browser timing skill\ndescription: Deliberate motion\n---\nPRIVATE_BROWSER_SKILL: Use visible anticipation and follow-through.';
  const file = { name: 'SKILL.md', mimeType: 'text/markdown', buffer: Buffer.from(skillText) };
  await label('builderPlus.uploadSkill').setInputFiles(file);
  await button('builderPlus.importSkill').waitFor();
  const [importResponse] = await Promise.all([
    page.waitForResponse((response) => response.url().endsWith('/api/arena/agent-skills') && response.request().method() === 'POST'),
    button('builderPlus.importSkill').click(),
  ]);
  assert.equal(importResponse.status(), 201);
  const skill = await importResponse.json();
  const checkbox = page.getByRole('checkbox', { name: /Browser timing skill/ });
  await eventually(async () => assert.equal(await checkbox.isChecked(), true), 'Imported Skill was not selected.');
  await checkbox.uncheck();
  assert.equal(await checkbox.isChecked(), false);
  await checkbox.check();
  const library = await (await context.request.get(`${base}/api/arena/agent-skills`)).json();
  assert.equal(library.length, 1);
  assert.deepEqual(library[0].ref, skill.ref);
  mark('Reject unsupported file, preview Markdown, import into PostgreSQL and select/remove Skill');

  await label('artifactArena.buildName').fill('Browser integration build');
  await label('artifactArena.instructions').fill('Private instructions that must survive language changes.');
  await page.locator('.language-option').filter({ hasText: /\u7b80\u4e2d/ }).click();
  assert.equal(await label('artifactArena.buildName', zhCN).inputValue(), 'Browser integration build');
  assert.equal(await label('artifactArena.instructions', zhCN).inputValue(), 'Private instructions that must survive language changes.');
  assert.equal(await checkbox.isChecked(), true);
  const [buildResponse] = await Promise.all([
    page.waitForResponse((response) => response.url().endsWith('/api/arena/builds') && response.request().method() === 'POST'),
    button('artifactArena.saveBuild', zhCN).click(),
  ]);
  assert.equal(buildResponse.status(), 201);
  const build = await buildResponse.json();
  assert.deepEqual(build.version.agentDefinition.skillRefs, [skill.ref]);
  await eventually(async () => assert.equal(await button('artifactArena.startRun', zhCN).isEnabled(), true), 'Saved build cannot be run in the availability fixture.');
  mark('Chinese UI preserves edits and saves the selected immutable Skill reference');
  const draft = 'Unsaved revision must survive reload and must not run an old version.';
  await label('artifactArena.instructions', zhCN).fill(draft);
  assert.equal(await button('artifactArena.startRun', zhCN).isDisabled(), true);
  await eventually(async () => {
    const raw = await page.evaluate((owner) => localStorage.getItem(`agentforge.artifact-arena.creation-v3:${owner}`), ownerId);
    assert.equal(JSON.parse(raw).draftInstructions, draft);
    assert.equal(raw.includes(fakeKey), false);
  }, 'User-scoped draft was not persisted.');
  await page.reload({ waitUntil: 'networkidle' });
  await eventually(async () => assert.equal(await label('artifactArena.instructions', zhCN).inputValue(), draft), 'Draft did not recover.');
  assert.equal(await checkbox.isChecked(), true);
  assert.equal(await button('artifactArena.startRun', zhCN).isDisabled(), true);
  await page.locator('.language-option').filter({ hasText: /^EN$/ }).click();
  assert.equal(await label('artifactArena.instructions').inputValue(), draft);
  mark('Unsaved draft recovery, bilingual switching and stale-version run prevention');

  let saves = 0;
  page.on('request', (request) => { if (request.url().endsWith('/api/arena/builds') && request.method() === 'POST') saves++; });
  const [updatedResponse] = await Promise.all([
    page.waitForResponse((response) => response.url().endsWith('/api/arena/builds') && response.request().method() === 'POST'),
    button('artifactArena.saveBuild').evaluate((element) => { element.click(); element.click(); }),
  ]);
  assert.equal(updatedResponse.status(), 201);
  const updated = await updatedResponse.json();
  assert.equal(updated.id, build.id);
  assert.equal(updated.version.revision, 2);
  await eventually(async () => assert.equal(await button('artifactArena.startRun').isEnabled(), true), 'Second version did not finish saving.');
  assert.equal(saves, 1);
  mark('Rapid duplicate clicks create exactly one new immutable Build version');

  await page.screenshot({ path: `${output}/desktop.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${output}/mobile.png`, fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, 'Mobile layout overflows the viewport.');
  mark('Desktop and 390px mobile layout without horizontal overflow');

  await context.request.post(`${base}/api/auth/sign-out`, { headers: { Origin: base }, data: {} });
  const otherId = await signup('Other browser account');
  assert.notEqual(otherId, ownerId);
  await page.reload({ waitUntil: 'networkidle' });
  await eventually(async () => assert.equal(await label('artifactArena.buildName').isEnabled(), true), 'Other account did not load.');
  assert.notEqual(await label('artifactArena.buildName').inputValue(), 'Browser integration build');
  assert.notEqual(await label('artifactArena.instructions').inputValue(), draft);
  assert.equal(await page.getByRole('checkbox').count(), 0);
  const forbidden = await context.request.get(`${base}/api/arena/builds/${build.id}?mode=agent`);
  assert.equal(forbidden.status(), 403);
  mark('Switching accounts cannot restore another account draft or read private Build/Skill data');
  assert.deepEqual(report.errors, []);
  assert.equal(report.generationCalls, 0);
  mark('No hydration/runtime errors and no generation requests');
} catch (error) {
  report.failure = error.stack ?? String(error);
  if (page && !page.isClosed()) await page.screenshot({ path: `${output}/failure.png`, fullPage: true }).catch(() => {});
  throw error;
} finally {
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  await context.close();
  await browser.close();
}

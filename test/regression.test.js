import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs-extra';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import * as cheerio from 'cheerio';
import ffmpeg from 'fluent-ffmpeg';
import { downloadFile, validateHttpUrl } from '../src/utils/download.js';
import { localUrlPath } from '../src/utils/html.js';
import FileManager from '../src/utils/fileManager.js';
import VideoDownloader from '../src/downloaders/videoDownloader.js';
import DocumentDownloader from '../src/downloaders/documentDownloader.js';
import HtmlDownloader from '../src/downloaders/htmlDownloader.js';
import BaseScraper from '../src/scrapers/baseScraper.js';
import CourseDownloader from '../src/courseDownloader.js';
import OfflineServer from '../src/server.js';

const run = promisify(execFile);
const config = { timeout: 2000, userAgent: 'Local fixture', downloadPath: './downloads', websites: { default: { selectors: {}, requiresAuth: false } } };

async function fixture(t, handler) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'auto-video-grabber-'));
  t.after(() => fs.remove(directory));
  const server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return { directory, url: `http://127.0.0.1:${server.address().port}` };
}

test('Interrupted streams reject, preserve existing output, and clean temporary files', { timeout: 5000 }, async t => {
  const { directory, url } = await fixture(t, (req, res) => {
    res.writeHead(200, { 'Content-Length': 100 });
    res.write('partial');
    setTimeout(() => res.destroy(), 10);
  });
  const output = path.join(directory, 'keep.mp4');
  await fs.writeFile(output, 'previous complete file');
  await assert.rejects(downloadFile(url, output, config));
  assert.equal(await fs.readFile(output, 'utf8'), 'previous complete file');
  assert.deepEqual(await fs.readdir(directory), ['keep.mp4']);
  await assert.rejects(new VideoDownloader(config).downloadVideo(url, directory, 'new'));
  assert.equal(await fs.pathExists(path.join(directory, 'new.mp4')), false);
  assert.deepEqual(await fs.readdir(directory), ['keep.mp4']);
});

test('Direct downloads create nested paths, replace empty files, and work through the ESM scraper helper', async t => {
  const { directory, url } = await fixture(t, (req, res) => res.end('complete content'));
  const outputDirectory = path.join(directory, 'nested', 'videos');
  await fs.ensureDir(outputDirectory);
  await fs.writeFile(path.join(outputDirectory, 'lesson.mp4'), '');
  const video = await new VideoDownloader(config).downloadVideo(`${url}/clip.mp4`, outputDirectory, 'lesson');
  assert.equal(await fs.readFile(video, 'utf8'), 'complete content');
  const scraper = new BaseScraper(url, config);
  const helperOutput = path.join(directory, 'helper', 'file.bin');
  await scraper.downloadFile(url, helperOutput);
  assert.equal(await fs.readFile(helperOutput, 'utf8'), 'complete content');
  const directoryTarget = path.join(directory, 'existing-directory');
  await fs.outputFile(path.join(directoryTarget, 'keep.txt'), 'existing directory content');
  await assert.rejects(downloadFile(url, directoryTarget, config));
  assert.equal(await fs.readFile(path.join(directoryTarget, 'keep.txt'), 'utf8'), 'existing directory content');
  const docs = await new DocumentDownloader(config).downloadDocuments([{ href: `${url}/notes.pdf?token=fixture`, filename: 'Notes & exercises.pdf' }], directory);
  assert.equal(docs[0].filename, 'Notes & exercises.pdf');
  assert.equal(docs[0].path, 'documents/Notes & exercises.pdf');
  assert.equal(await fs.readFile(path.join(directory, docs[0].path), 'utf8'), 'complete content');
});

test('Unsafe URL protocols, empty names, and unsafe local hrefs are rejected before side effects', async () => {
  assert.throws(() => validateHttpUrl('file:///private/file'), /HTTP/);
  assert.throws(() => new BaseScraper('javascript:alert(1)', config), /HTTP/);
  const manager = new FileManager();
  for (const value of ['', '.', '..', 'CON']) assert.throws(() => manager.sanitizeFilename(value), /filename/);
  for (const value of ['../secret', '/absolute', 'C:\\secret', 'javascript:alert(1)']) assert.throws(() => localUrlPath(value), /resource path/);
});

test('Network capture ignores DASH and transport segments and removes its listeners', async () => {
  const scraper = new BaseScraper('http://fixture.test', config);
  const page = new EventEmitter();
  page.evaluate = async () => {
    for (const url of ['http://fixture.test/manifest.mpd', 'http://fixture.test/video.ts', 'http://fixture.test/video.webm', 'http://fixture.test/video.webm']) {
      page.emit('request', { url: () => url });
    }
    for (const contentType of ['application/dash+xml', 'video/mp2t', 'application/x-mpegURL']) {
      page.emit('response', { url: () => `http://fixture.test/manifest?type=${contentType}`, headers: () => ({ 'content-type': contentType }) });
    }
  };
  scraper.page = page;
  const videos = await scraper.captureVideoUrlsFromNetwork(0);
  assert.equal(videos.length, 2);
  assert.equal(videos[0].url, 'http://fixture.test/video.webm');
  assert.equal(videos[1].type, 'hls');
  assert.equal(page.listenerCount('request'), 0);
  assert.equal(page.listenerCount('response'), 0);
});

test('Authentication confirmation pauses input and EOF rejects without hanging', async () => {
  const scraper = new BaseScraper('http://fixture.test', config);
  const input = new PassThrough();
  const confirmation = scraper.waitForAuth(input);
  input.write('\n');
  await confirmation;
  assert.equal(input.isPaused(), true);
  assert.equal(input.listenerCount('data'), 0);
  const closedInput = new PassThrough();
  const ended = scraper.waitForAuth(closedInput);
  closedInput.end();
  await assert.rejects(ended, /closed before confirmation/);
});

test('Malformed filename escapes do not discard valid document links or prevent downloads', async t => {
  const { directory, url } = await fixture(t, (req, res) => res.end('document fixture'));
  const scraper = new BaseScraper(url, config);
  const links = ['notes-100%.pdf', 'invalid-%FF.pdf', 'good%20notes.pdf'].map(filename => ({ href: `${url}/${filename}`, textContent: filename }));
  scraper.page = { evaluate: async (callback, selectors) => {
    const previous = globalThis.document;
    globalThis.document = { querySelectorAll: () => links };
    try { return callback(selectors); }
    finally { if (previous === undefined) delete globalThis.document; else globalThis.document = previous; }
  } };
  const documents = await scraper.extractDocuments({ documents: 'a' });
  assert.deepEqual(documents.map(doc => doc.filename), ['notes-100%.pdf', 'invalid-%FF.pdf', 'good notes.pdf']);
  const output = await new DocumentDownloader(config).downloadDocument(`${url}/notes-100%.pdf`, directory);
  assert.equal(path.basename(output), 'notes-100%.pdf');
  assert.equal(await fs.readFile(output, 'utf8'), 'document fixture');
});

test('Offline HTML references actual downloaded assets and escapes index metadata', async t => {
  const { directory, url } = await fixture(t, (req, res) => {
    if (req.url === '/missing.png') { res.writeHead(404); res.end(); }
    else res.end(req.url);
  });
  const downloader = new HtmlDownloader(config);
  const resources = new Map([[`${url}/notes.pdf?token=fixture`, '../documents/Notes%20%26%20exercises.pdf']]);
  const images = [`${url}/first/image.png`, `${url}/second/image.png`, `${url}/missing.png`];
  const page = { evaluate: async () => images };
  assert.equal(await downloader.downloadImages(page, path.join(directory, 'html'), resources), 2);
  assert.notEqual(resources.get(images[0]), resources.get(images[1]));
  const html = await downloader.processHtml(`<html><head><base href="${url}/"></head><body><video src="blob:fixture"><source src="clip.m3u8"></video><a href="notes.pdf?token=fixture">Notes</a><img src="first/image.png" srcset="remote.png 2x"><img src="missing.png"></body></html>`, `${url}/course`, resources, '../videos/1_Lesson.mp4');
  const $ = cheerio.load(html);
  assert.equal($('base').length, 0);
  assert.equal($('video').attr('src'), '../videos/1_Lesson.mp4');
  assert.equal($('video source').length, 0);
  assert.equal($('a').attr('href'), '../documents/Notes%20%26%20exercises.pdf');
  assert.equal($('img').first().attr('src'), resources.get(images[0]));
  assert.equal($('img').first().attr('srcset'), undefined);
  assert.equal($('img').last().attr('src'), `${url}/missing.png`);
  await downloader.createIndexPage(directory, { courseTitle: '<script>injected</script>', downloadDate: '2026-01-01', lessons: [{ title: '<img src=x onerror=bad>', htmlPath: 'html/Lesson one.html' }], videos: [], documents: [] });
  const index = cheerio.load(await fs.readFile(path.join(directory, 'index.html'), 'utf8'));
  assert.equal(index('script').length, 0);
  assert.equal(index('img').length, 0);
  assert.equal(index('h1').text(), '<script>injected</script>');
  assert.equal(index('.lesson-link').attr('href'), 'html/Lesson%20one.html');
});

test('Offline server contains API paths, tolerates malformed manifests, escapes titles, and propagates bind errors', async t => {
  const { directory } = await fixture(t, (req, res) => res.end());
  const downloads = path.join(directory, 'downloads');
  const title = '<script>injected</script>';
  await fs.outputJson(path.join(downloads, 'fixture.test', 'Course #1', 'manifest.json'), { courseTitle: title, lessons: [], videos: [], documents: [], downloadDate: '2026-01-01' });
  await fs.outputFile(path.join(downloads, 'fixture.test', 'broken', 'manifest.json'), '{broken');
  await fs.outputJson(path.join(directory, 'outside', 'manifest.json'), { secret: 'outside fixture' });
  await fs.symlink(path.join(directory, 'outside'), path.join(downloads, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  const server = new OfflineServer(0, downloads);
  t.after(() => server.stop());
  await server.start();
  const base = `http://127.0.0.1:${server.port}`;
  const courses = await (await fetch(`${base}/api/courses`)).json();
  assert.equal(courses.length, 1);
  assert.equal(courses[0].path, '/fixture.test/Course%20%231/index.html');
  const html = cheerio.load(await (await fetch(base)).text());
  assert.equal(html('script').length, 0);
  assert.equal(html('.course-title').text(), title);
  const response = await fetch(`${base}/api/course/%2e%2e%5coutside/unused`);
  assert.equal(response.status, 404);
  assert.equal((await fetch(`${base}/linked/manifest.json`)).status, 404);
  assert.equal((await fetch(`${base}/api/course/fixture.test/Course%20%231`)).status, 200);
  const conflict = new OfflineServer(server.port, downloads);
  await assert.rejects(conflict.start(), error => error.code === 'EADDRINUSE');
  await server.stop();
  assert.equal(server.server, null);
  for (const port of [NaN, -1, 65536, 1.5]) assert.throws(() => new OfflineServer(port), /Port/);
});

test('An explicitly selected junction downloads root serves its contained courses', async t => {
  const { directory } = await fixture(t, (req, res) => res.end());
  const downloads = path.join(directory, 'actual-downloads');
  const alias = path.join(directory, 'selected-downloads');
  await fs.outputJson(path.join(downloads, 'fixture.test', 'Course', 'manifest.json'), { courseTitle: 'Junction course', lessons: [], videos: [], documents: [], downloadDate: '2026-01-01' });
  await fs.outputFile(path.join(downloads, 'fixture.test', 'Course', 'index.html'), 'Contained course index');
  await fs.symlink(downloads, alias, process.platform === 'win32' ? 'junction' : 'dir');
  const server = new OfflineServer(0, alias);
  t.after(() => server.stop());
  await server.start();
  const base = `http://127.0.0.1:${server.port}`;
  assert.equal((await (await fetch(`${base}/api/courses`)).json())[0].title, 'Junction course');
  assert.equal((await fetch(`${base}/api/course/fixture.test/Course`)).status, 200);
  assert.equal(await (await fetch(`${base}/fixture.test/Course/`)).text(), 'Contained course index');
});

test('Static directory indexes cannot follow a file symlink outside the downloads root', async t => {
  const { directory } = await fixture(t, (req, res) => res.end());
  const downloads = path.join(directory, 'downloads');
  const course = path.join(downloads, 'fixture.test', 'Course');
  const outside = path.join(directory, 'outside.html');
  await fs.ensureDir(course);
  await fs.writeFile(outside, 'Outside fixture contents');
  try {
    await fs.symlink(outside, path.join(course, 'index.html'), 'file');
  } catch (error) {
    if (error.code === 'EPERM') { t.skip('File symlinks require operating system capability'); return; }
    throw error;
  }
  const server = new OfflineServer(0, downloads);
  t.after(() => server.stop());
  await server.start();
  const base = `http://127.0.0.1:${server.port}`;
  for (const suffix of ['', '/', '/index.html']) {
    const response = await fetch(`${base}/fixture.test/Course${suffix}`);
    assert.equal(response.status, 404);
    assert.doesNotMatch(await response.text(), /Outside fixture contents/);
  }
});

test('Failed lesson navigation records partial state instead of reusing the previous page', async t => {
  const { directory, url } = await fixture(t, (req, res) => res.end());
  let closed = 0;
  const methods = {
    initialize: async function () { this.page = { content: async () => '<html><head></head><body>Fixture</body></html>', url: () => `${url}/good`, evaluate: async () => [] }; },
    navigateTo: async target => !target.endsWith('/failed'),
    getCourseTitle: async () => 'Fixture course',
    extractLessons: async () => [{ title: 'Good lesson', url: `${url}/good` }, { title: 'Failed lesson', url: `${url}/failed` }],
    captureVideoUrlsFromNetwork: async () => [],
    extractVideos: async () => [],
    extractDocuments: async () => [],
    close: async () => { closed++; }
  };
  for (const [name, implementation] of Object.entries(methods)) {
    const original = BaseScraper.prototype[name];
    BaseScraper.prototype[name] = implementation;
    t.after(() => { BaseScraper.prototype[name] = original; });
  }
  const result = await new CourseDownloader({ ...config, downloadPath: directory }).download(`${url}/course`, 'fixture.test');
  assert.equal(result.success, false);
  assert.equal(closed, 1);
  assert.equal(result.manifest.lessons.length, 1);
  assert.equal(result.manifest.failures.length, 1);
  assert.equal(result.manifest.lessons[0].htmlPath, 'html/1_Good lesson.html');
  assert.equal(await fs.pathExists(path.join(result.coursePath, 'html', '2_Failed lesson.html')), false);
  const saved = await fs.readJson(path.join(result.coursePath, 'manifest.json'));
  assert.equal(saved.failures[0].url, `${url}/failed`);
});

test('CLI help and invalid server input complete without launching download dependencies', async () => {
  const root = path.resolve('src/index.js');
  const { stdout } = await run(process.execPath, [root, '--help'], { timeout: 5000 });
  assert.match(stdout, /download/);
  await assert.rejects(run(process.execPath, [root, 'serve', '--port', '3000bad'], { timeout: 5000 }), error => error.code === 1 && /Port/.test(error.stdout));
  await assert.rejects(run(process.execPath, [path.resolve('src/server.js'), '--port', '3000bad'], { timeout: 5000 }), error => error.code === 1 && /Port/.test(error.stdout));
});

test('Standalone server honors a custom downloads directory and port', { timeout: 10000 }, async t => {
  const { directory } = await fixture(t, (req, res) => res.end());
  await fs.outputJson(path.join(directory, 'fixture.test', 'Custom course', 'manifest.json'), { courseTitle: 'Custom course', lessons: [], videos: [], documents: [], downloadDate: '2026-01-01' });
  const child = spawn(process.execPath, [path.resolve('src/server.js'), '--port', '0', '--dir', directory], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => new Promise(resolve => {
    if (child.exitCode !== null) return resolve();
    child.once('exit', resolve);
    child.kill();
  }));
  const port = await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error('Server startup timed out')), 5000);
    child.once('error', reject);
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Server exited with ${code}`)); });
    child.stdout.on('data', chunk => {
      output += chunk;
      const match = output.match(/localhost:(\d+)/);
      if (match) { clearTimeout(timer); resolve(Number(match[1])); }
    });
  });
  assert.ok(port > 0);
  const courses = await (await fetch(`http://127.0.0.1:${port}/api/courses`)).json();
  assert.equal(courses[0].title, 'Custom course');
});

test('Native FFmpeg handles a small local HLS fixture and cleans failed output', { skip: !process.env.TEST_FFMPEG_PATH, timeout: 45000 }, async t => {
  const executable = process.env.TEST_FFMPEG_PATH;
  const { directory, url } = await fixture(t, async (req, res) => {
    const filename = path.basename(new URL(req.url, 'http://fixture').pathname);
    const requested = path.join(directory, filename);
    if (!await fs.pathExists(requested)) { res.writeHead(404); res.end(); }
    else res.end(await fs.readFile(requested));
  });
  await run(executable, ['-y', '-f', 'lavfi', '-i', 'color=c=blue:s=32x32:r=10', '-f', 'lavfi', '-i', 'sine=f=1000:r=44100', '-t', '0.5', '-c:v', 'libx264', '-c:a', 'aac', '-f', 'hls', '-hls_time', '1', '-hls_list_size', '0', path.join(directory, 'fixture.m3u8')], { timeout: 10000 });
  ffmpeg.setFfmpegPath(executable);
  const outputDirectory = path.join(directory, 'videos');
  const output = await new VideoDownloader(config).downloadVideo(`${url}/fixture.m3u8?fixture=1`, outputDirectory, 'Native HLS');
  assert.equal((await fs.readFile(output)).subarray(4, 8).toString(), 'ftyp');
  await run(executable, ['-v', 'error', '-i', output, '-f', 'null', '-'], { timeout: 10000 });
  await assert.rejects(new VideoDownloader(config).downloadHLS(`${url}/missing.m3u8`, path.join(outputDirectory, 'failed.mp4')));
  assert.deepEqual(await fs.readdir(outputDirectory), ['Native HLS.mp4']);
});

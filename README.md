# Auto Video Grabber

A Node.js CLI for saving videos, documents, and lesson HTML from educational websites, with a local course library viewer. It uses Puppeteer for page inspection, HTTP requests for direct assets, and FFmpeg for HLS playlists.

## Installation

Use Node.js 22 or newer and install the locked dependencies:

```bash
npm ci
```

The normal installation downloads Puppeteer's browser and the `ffmpeg-static` binary. Browser launch also requires the operating system dependencies needed by Chrome. Run commands from the project directory so the CLI can read `config.json`.

## Download a course

```bash
npm start -- download https://example.com/course
npm start -- download https://example.com/course --website example.com --output ./downloads
```

Only HTTP and HTTPS URLs are supported. The optional website name selects an entry in `config.json`; otherwise the hostname is used, with the leading `www.` removed. Unconfigured websites use the `default` selectors.

The download command extracts lesson links, then visits each lesson in sequence. It saves available video, documents, images, and HTML, followed by a manifest and course index. A page with no lesson links is processed as a single lesson.

New direct and HLS downloads use temporary files and publish their final paths after successful completion. Non-empty files already at the expected path are skipped. Existing files are not checked for media validity, so remove a known damaged file before retrying. Failed lessons and document downloads are recorded in the manifest's `failures` array; a partial download exits with a nonzero status.

## Browse and list courses

```bash
npm run serve
npm run serve -- --port 3001 --dir ./downloads
npm start -- serve --port 3001 --dir ./downloads
npm start -- list --dir ./downloads
```

Open the URL printed by the server. The viewer binds to `127.0.0.1`, so it is accessible from the same computer. The server and list commands default to `./downloads`; pass `--dir` when a course was downloaded to another location.

Saved HTML links use the actual local video, document, and image paths. Stylesheets, scripts, other links, and failed image downloads can still reference the original website. This is a content archive rather than a complete offline copy of an interactive web application. Course and lesson text is escaped in generated library/index pages; archived source pages can retain their original scripts.

## Configuration

```bash
npm start -- config
npm start -- debug https://example.com/course
```

`config` prints the effective configuration. `debug` opens a browser, inspects page links and expandable sections, and writes `debug-page-structure.json` in the current directory. It does not download a course.

Edit the project `config.json` to configure `downloadPath`, the HTTP `timeout` in milliseconds, `userAgent`, and website selectors:

```json
{
  "downloadPath": "./downloads",
  "timeout": 60000,
  "userAgent": "Mozilla/5.0",
  "websites": {
    "example.com": {
      "selectors": {
        "courseTitle": "h1",
        "videoPlayer": "video",
        "videoSource": "video source",
        "lessonList": "a.lesson",
        "documents": "a[href$='.pdf']",
        "content": "main"
      },
      "requiresAuth": false
    },
    "default": {
      "selectors": {
        "videoPlayer": "video",
        "documents": "a[href$='.pdf']"
      },
      "requiresAuth": false
    }
  }
}
```

The `courseTitle`, `videoPlayer`, `lessonList`, and `documents` selectors drive extraction. The current implementation does not apply `maxConcurrentDownloads`, `retryAttempts`, `waitForSelector`, `useNetworkCapture`, `videoSource`, or `content` as configurable controls. Downloads are sequential; video detection attempts network capture and then the first DOM video source.

## Authentication and format limits

For a website configured with `requiresAuth: true`, the browser opens visibly. Log in manually, reach the course page, and press Enter in the terminal to continue. Browser session cookies are not forwarded automatically to Axios or FFmpeg, so protected asset URLs may still fail.

The downloader handles direct HTTP video files and HLS URLs whose pathname ends in `.m3u8`, plus HLS playlists identified by captured network responses. Direct videos are saved with an `.mp4` filename without transcoding; the original container may differ. DASH, DRM-protected video, and browser-only `blob:` URLs are not supported download formats. Configure document selectors for the file types your site exposes.

Use the tool only for content you are authorized to save and respect the source website's terms.

## Output structure

```text
downloads/
  example.com/
    Course Name/
      videos/
      documents/
      html/
        images/
      index.html
      manifest.json
```

Filenames are sanitized, and generated navigation links encode URL path segments so spaces and punctuation work in the viewer. Image filenames include a URL-derived prefix to distinguish images with the same basename.

## Validation

```bash
npm test
```

The regression suite uses temporary directories, small loopback HTTP fixtures, and a mocked browser boundary. It covers interrupted transfers, path validation, generated HTML, server bind errors, CLI startup, and partial course state. Set `TEST_FFMPEG_PATH` to an existing FFmpeg executable to also generate, download, and decode a tiny local HLS fixture. Tests do not log in to a website or download external course content.

## License

MIT, as declared in `package.json`.

# Auto Video Grabber

A powerful automation tool for downloading educational content from various websites for offline learning. Download videos, HTML content, documents, and navigate through courses offline.

## Features

- **Video Downloads**: Support for MP4 and HLS streaming formats
- **HTML Content**: Save complete web pages with local resource linking
- **Documents**: Download PDFs, Office documents, and archives
- **Offline Navigation**: Beautiful web interface for browsing downloaded courses
- **Multi-site Support**: Configurable selectors for different websites
- **Progress Tracking**: Real-time download progress and status updates
- **Resume Support**: Skip already downloaded files

## Installation

```bash
npm install
```

## Quick Start

### Download a Course

```bash
npm start download <course-url>
```

Example:
```bash
npm start download https://ine.com/learning/courses/your-course
```

### View Downloaded Courses

Start the offline server:
```bash
npm run serve
```

Then open your browser to `http://localhost:3000`

### List Downloaded Courses

```bash
npm start list
```

## Usage

### Download Command

```bash
npm start download <url> [options]

Options:
  -w, --website <name>   Specify website name (e.g., ine.com)
  -o, --output <path>    Custom output directory
```

### Serve Command

```bash
npm run serve [options]

Options:
  -p, --port <number>    Port number (default: 3000)
  -d, --dir <path>       Downloads directory (default: ./downloads)
```

### List Command

```bash
npm start list [options]

Options:
  -d, --dir <path>       Downloads directory (default: ./downloads)
```

### Config Command

```bash
npm start config
```

## Configuration

Edit `config.json` to customize settings:

```json
{
  "downloadPath": "./downloads",
  "maxConcurrentDownloads": 3,
  "retryAttempts": 3,
  "timeout": 30000,
  "websites": {
    "ine.com": {
      "selectors": {
        "courseTitle": "h1.course-title",
        "videoPlayer": "video",
        "lessonList": "a.lesson-item"
      },
      "requiresAuth": true
    }
  }
}
```

### Website Configuration

For each website, you can configure:

- **selectors**: CSS selectors for finding elements
  - `courseTitle`: Course title element
  - `videoPlayer`: Video player element
  - `videoSource`: Video source elements
  - `lessonList`: Lesson navigation links
  - `documents`: Document download links
  - `content`: Main content area

- **requiresAuth**: Set to `true` if login is required
- **waitForSelector**: Element to wait for before extraction

## How It Works

1. **Browser Automation**: Uses Puppeteer to navigate and extract content
2. **Content Extraction**: Identifies videos, documents, and lessons
3. **Downloads**: Downloads all resources with progress tracking
4. **Local Processing**: Rewrites HTML links to work offline
5. **Index Generation**: Creates beautiful navigation pages

## Authentication

For websites requiring authentication:

1. The tool will open a browser window
2. Log in manually in the browser
3. Navigate to the course page
4. Press Enter in the terminal to continue

## Directory Structure

```
downloads/
├── website.com/
│   ├── Course Name/
│   │   ├── videos/
│   │   │   ├── 1_lesson-name.mp4
│   │   │   └── 2_lesson-name.mp4
│   │   ├── documents/
│   │   │   ├── slides.pdf
│   │   │   └── resources.zip
│   │   ├── html/
│   │   │   ├── 1_lesson-name.html
│   │   │   └── images/
│   │   ├── index.html
│   │   └── manifest.json
```

## Supported Formats

### Videos
- MP4 (direct download)
- HLS/M3U8 (streaming playlists)
- WebM

### Documents
- PDF
- DOC/DOCX
- PPT/PPTX
- XLS/XLSX
- ZIP/RAR

## Troubleshooting

### Videos not downloading
- Check if the website uses DRM protection
- Verify video selectors in config.json
- Try manual authentication if required

### Browser not opening
- Ensure Puppeteer is properly installed
- Check system dependencies for Chrome/Chromium

### Download failures
- Increase timeout in config.json
- Check network connection
- Verify you have authentication if needed

## Advanced Usage

### Custom Selectors

Add website-specific configuration in `config.json`:

```json
"yoursite.com": {
  "selectors": {
    "courseTitle": ".course-header h1",
    "videoPlayer": "#video-player",
    "lessonList": ".lesson-nav a"
  },
  "requiresAuth": true
}
```

### Batch Downloads

Create a script to download multiple courses:

```javascript
import CourseDownloader from './src/courseDownloader.js';

const urls = [
  'https://site.com/course1',
  'https://site.com/course2'
];

for (const url of urls) {
  await downloader.download(url);
}
```

## Notes

- This tool is for personal educational use only
- Respect website terms of service
- Ensure you have rights to download content
- Some websites may have anti-scraping measures

## License

MIT

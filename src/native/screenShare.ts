import {
  BrowserWindow,
  desktopCapturer,
  type Session,
} from "electron";

/**
 * Register the display media handler so that getDisplayMedia() calls
 * from the renderer (e.g. LiveKit screen sharing) are intercepted and
 * resolved through desktopCapturer with a source-picker window.
 */
export function setupScreenShare(
  session: Session,
  parentWindow: BrowserWindow,
): void {
  session.setDisplayMediaRequestHandler((_request, callback) => {
    pickSource(parentWindow)
      .then((source) => {
        if (source) {
          callback({ video: source });
        } else {
          callback({} as Electron.Streams);
        }
      })
      .catch(() => {
        callback({} as Electron.Streams);
      });
  });
}

async function pickSource(
  parentWindow: BrowserWindow,
): Promise<Electron.DesktopCapturerSource | null> {
  const sources = await desktopCapturer.getSources({
    types: ["screen", "window"],
    thumbnailSize: { width: 320, height: 180 },
    fetchWindowIcons: true,
  });

  if (sources.length === 0) return null;
  if (sources.length === 1) return sources[0];

  return new Promise<Electron.DesktopCapturerSource | null>((resolve) => {
    let resolved = false;
    const finish = (source: Electron.DesktopCapturerSource | null) => {
      if (resolved) return;
      resolved = true;
      resolve(source);
      if (!picker.isDestroyed()) picker.close();
    };

    const picker = new BrowserWindow({
      parent: parentWindow,
      modal: true,
      width: 680,
      height: 460,
      resizable: false,
      minimizable: false,
      maximizable: false,
      frame: false,
      show: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    // The picker page signals selection by changing document.title
    // to "PICK:<sourceId>" or "PICK:" (cancel).
    picker.webContents.on("page-title-updated", (_event, title) => {
      if (!title.startsWith("PICK:")) return;
      const sourceId = title.slice(5) || null;
      const selected = sourceId
        ? sources.find((s) => s.id === sourceId) ?? null
        : null;
      finish(selected);
    });

    picker.on("closed", () => finish(null));

    const sourcesPayload = sources.map((s) => ({
      id: s.id,
      name: s.name,
      thumbnail: s.thumbnail.toDataURL(),
    }));

    const html = buildPickerHtml(sourcesPayload);
    picker.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(html)}`,
    );
    picker.once("ready-to-show", () => picker.show());
  });
}

function buildPickerHtml(
  sources: Array<{ id: string; name: string; thumbnail: string }>,
): string {
  const items = sources
    .map(
      (s) => `
    <button class="source" data-id="${escapeAttr(s.id)}">
      <img src="${escapeAttr(s.thumbnail)}" alt="" />
      <span class="label">${escapeHtml(s.name)}</span>
    </button>`,
    )
    .join("");

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: #1e1e2e; color: #cdd6f4;
    display: flex; flex-direction: column; height: 100vh;
    user-select: none; -webkit-app-region: drag;
  }
  .header {
    padding: 16px 20px 8px; font-size: 15px; font-weight: 600;
    display: flex; justify-content: space-between; align-items: center;
  }
  .close-btn {
    -webkit-app-region: no-drag;
    background: none; border: none; color: #cdd6f4; font-size: 20px;
    cursor: pointer; padding: 4px 8px; border-radius: 4px;
  }
  .close-btn:hover { background: #313244; }
  .grid {
    -webkit-app-region: no-drag;
    display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 12px; padding: 12px 20px; overflow-y: auto; flex: 1;
  }
  .source {
    background: #313244; border: 2px solid transparent; border-radius: 8px;
    cursor: pointer; padding: 8px; display: flex; flex-direction: column;
    align-items: center; gap: 8px; transition: border-color 0.15s;
    font-family: inherit; color: inherit;
  }
  .source:hover { border-color: #89b4fa; }
  .source:focus { outline: none; border-color: #89b4fa; }
  .source img { width: 100%; border-radius: 4px; }
  .label {
    font-size: 12px; text-align: center;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    max-width: 100%;
  }
</style>
</head>
<body>
  <div class="header">
    <span>Select a screen or window to share</span>
    <button class="close-btn" id="cancel">&times;</button>
  </div>
  <div class="grid">${items}</div>
  <script>
    function pick(sourceId) {
      document.title = 'PICK:' + (sourceId || '');
    }
    document.querySelectorAll('.source').forEach(btn => {
      btn.addEventListener('click', () => pick(btn.dataset.id));
    });
    document.getElementById('cancel').addEventListener('click', () => pick(''));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') pick('');
    });
  </script>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

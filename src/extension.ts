import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

interface ImageDiffData {
  currentPath: string;
  currentData: Buffer;
  previousData: Buffer;
  currentLabel: string;
  previousLabel: string;
}

interface GitVersionOptions {
  filePath: string;
  revision: string;
  workspaceRoot: string;
}

function isImageFile(uri: vscode.Uri): boolean {
  return /\.(png|jpg|jpeg|gif|bmp|webp)$/i.test(uri.fsPath);
}

export function activate(context: vscode.ExtensionContext) {
  const commands = [
    vscode.commands.registerCommand(
      'imageDiff.compareWithPrevious',
      handleCompareWithPrevious
    ),
    vscode.commands.registerCommand(
      'imageDiff.openScmChanges',
      handleOpenScmChanges
    ),
    vscode.commands.registerCommand(
      'imageDiff.openAsDiffTool',
      handleOpenAsDiffTool
    ),
  ];

  const imageEditorProvider = vscode.window.registerCustomEditorProvider(
    'imageDiff.imagePreview',
    new ImagePreviewEditorProvider(context),
    {
      webviewOptions: { retainContextWhenHidden: true },
      supportsMultipleEditorsPerDocument: false,
    }
  );

  context.subscriptions.push(...commands, imageEditorProvider);

  async function handleCompareWithPrevious(uri: vscode.Uri) {
    try {
      const currentImagePath = uri.fsPath;
      const workspaceRoot = getWorkspaceRoot(uri);

      if (!workspaceRoot) return;

      const previousImageData = await GitService.getVersion({
        filePath: currentImagePath,
        revision: 'HEAD~1',
        workspaceRoot,
      });

      if (!previousImageData) {
        vscode.window.showWarningMessage(
          'Cannot retrieve previous version (HEAD~1) of this image from Git'
        );
        return;
      }

      const currentImageData = await FileService.readFile(currentImagePath);

      DiffViewerService.openDiffViewer(context, {
        currentPath: currentImagePath,
        currentData: currentImageData,
        previousData: previousImageData,
        currentLabel: 'Current',
        previousLabel: 'Previous Commit (HEAD~1)',
      });
    } catch (error) {
      vscode.window.showErrorMessage(`Error: ${error}`);
    }
  }

  async function handleOpenScmChanges(
    resourceState: vscode.SourceControlResourceState
  ) {
    try {
      const uri = resourceState.resourceUri;

      if (!uri || !isImageFile(uri)) {
        vscode.window.showErrorMessage(
          'Please select an image file to compare with the previous version.'
        );
        return;
      }

      const currentImagePath = uri.fsPath;
      const workspaceRoot = getWorkspaceRoot(uri);

      if (!workspaceRoot) return;

      const headImageData = await GitService.getVersion({
        filePath: currentImagePath,
        revision: 'HEAD',
        workspaceRoot,
      });

      if (!headImageData) {
        vscode.window.showWarningMessage(
          'Cannot retrieve HEAD version of this image. This might be a new file.'
        );
        return;
      }

      const currentImageData = await FileService.readFile(currentImagePath);

      DiffViewerService.openDiffViewer(context, {
        currentPath: currentImagePath,
        currentData: currentImageData,
        previousData: headImageData,
        currentLabel: 'Working Tree',
        previousLabel: 'HEAD',
      });
    } catch (error) {
      vscode.window.showErrorMessage(`Error opening SCM changes: ${error}`);
    }
  }

  async function handleOpenAsDiffTool(
    left: vscode.Uri,
    right: vscode.Uri,
    title?: string
  ) {
    try {
      if (!left || !right) {
        vscode.window.showErrorMessage(
          'Two image files are required for comparison'
        );
        return;
      }

      const [leftData, rightData] = await Promise.all([
        FileService.readFile(left.fsPath),
        FileService.readFile(right.fsPath),
      ]);

      DiffViewerService.openTwoFilesDiffViewer(context, {
        leftPath: left.fsPath,
        rightPath: right.fsPath,
        leftData,
        rightData,
        title,
      });
    } catch (error) {
      vscode.window.showErrorMessage(`Error: ${error}`);
    }
  }

  function getWorkspaceRoot(uri: vscode.Uri): string | null {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
      vscode.window.showErrorMessage(
        'No workspace found. This extension requires a Git repository.'
      );
      return null;
    }

    const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
    if (!workspaceFolder) {
      vscode.window.showErrorMessage(
        `File does not belong to any open workspace: ${uri.fsPath}`
      );
      return null;
    }

    return workspaceFolder.uri.fsPath;
  }
}

class GitService {
  static async getVersion(options: GitVersionOptions): Promise<Buffer | null> {
    try {
      const { filePath, revision, workspaceRoot } = options;
      const relativePath = path
        .relative(workspaceRoot, filePath)
        .replace(/\\/g, '/');
      const gitCommand = `git show ${revision}:"${relativePath}"`;

      console.log(`Executing: ${gitCommand}`);

      const content = execSync(gitCommand, {
        cwd: workspaceRoot,
        encoding: 'buffer',
        maxBuffer: 10 * 1024 * 1024,
      });

      return content;
    } catch (error) {
      console.error(
        `Cannot get version '${options.revision}' of file '${options.filePath}':`,
        error
      );
      return null;
    }
  }
}

class FileService {
  static async readFile(filePath: string): Promise<Buffer> {
    return fs.readFileSync(filePath);
  }

  static getImageBase64(data: Buffer, filePath: string): string {
    const ext = path.extname(filePath).slice(1);
    return `data:image/${ext};base64,${data.toString('base64')}`;
  }
}

class DiffImageGenerator {
  static async generate(
    currentData: Buffer,
    previousData: Buffer
  ): Promise<string | null> {
    try {
      const currentPng = PNG.sync.read(currentData);
      const previousPng = PNG.sync.read(previousData);

      const width = Math.max(currentPng.width, previousPng.width);
      const height = Math.max(currentPng.height, previousPng.height);

      const currentImg = new PNG({ width, height });
      const previousImg = new PNG({ width, height });
      const diffImg = new PNG({ width, height });

      PNG.bitblt(
        currentPng,
        currentImg,
        0,
        0,
        currentPng.width,
        currentPng.height,
        0,
        0
      );
      PNG.bitblt(
        previousPng,
        previousImg,
        0,
        0,
        previousPng.width,
        previousPng.height,
        0,
        0
      );

      pixelmatch(
        currentImg.data,
        previousImg.data,
        diffImg.data,
        width,
        height,
        { threshold: 0.1, includeAA: false }
      );

      const diffBuffer = PNG.sync.write(diffImg);
      return `data:image/png;base64,${diffBuffer.toString('base64')}`;
    } catch (error) {
      console.error('Failed to generate diff image:', error);
      return null;
    }
  }
}

class DiffViewerService {
  static openDiffViewer(context: vscode.ExtensionContext, data: ImageDiffData) {
    const panel = this.createWebviewPanel(
      `Image Diff - ${path.basename(data.currentPath)}`,
      context,
      [path.dirname(data.currentPath)]
    );

    const currentImageBase64 = FileService.getImageBase64(
      data.currentData,
      data.currentPath
    );
    const previousImageBase64 = FileService.getImageBase64(
      data.previousData,
      data.currentPath
    );

    DiffImageGenerator.generate(data.currentData, data.previousData).then(
      (diffImageBase64) => {
        panel.webview.html = WebviewContentGenerator.getDiffViewerContent({
          currentImage: currentImageBase64,
          previousImage: previousImageBase64,
          diffImage: diffImageBase64,
          currentLabel: data.currentLabel,
          previousLabel: data.previousLabel,
        });
      }
    );
  }

  static openTwoFilesDiffViewer(
    context: vscode.ExtensionContext,
    options: {
      leftPath: string;
      rightPath: string;
      leftData: Buffer;
      rightData: Buffer;
      title?: string;
    }
  ) {
    const { leftPath, rightPath, leftData, rightData, title } = options;

    const panel = this.createWebviewPanel(
      title ||
        `Image Diff - ${path.basename(leftPath)} ↔ ${path.basename(rightPath)}`,
      context,
      [path.dirname(leftPath), path.dirname(rightPath)]
    );

    const leftImageBase64 = FileService.getImageBase64(leftData, leftPath);
    const rightImageBase64 = FileService.getImageBase64(rightData, rightPath);

    DiffImageGenerator.generate(rightData, leftData).then((diffImageBase64) => {
      panel.webview.html = WebviewContentGenerator.getDiffViewerContent({
        currentImage: rightImageBase64,
        previousImage: leftImageBase64,
        diffImage: diffImageBase64,
        currentLabel: 'Current',
        previousLabel: 'Previous',
      });
    });
  }

  private static createWebviewPanel(
    title: string,
    context: vscode.ExtensionContext,
    localResourceRoots: string[]
  ): vscode.WebviewPanel {
    return vscode.window.createWebviewPanel(
      'imageDiff',
      title,
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [
          ...localResourceRoots.map((root) => vscode.Uri.file(root)),
          context.extensionUri,
        ],
      }
    );
  }
}

class ImagePreviewEditorProvider
  implements vscode.CustomReadonlyEditorProvider
{
  constructor(private readonly context: vscode.ExtensionContext) {}

  async openCustomDocument(
    uri: vscode.Uri,
    openContext: vscode.CustomDocumentOpenContext,
    token: vscode.CancellationToken
  ): Promise<vscode.CustomDocument> {
    return { uri, dispose: () => {} };
  }

  async resolveCustomEditor(
    document: vscode.CustomDocument,
    webviewPanel: vscode.WebviewPanel,
    token: vscode.CancellationToken
  ): Promise<void> {
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.file(path.dirname(document.uri.fsPath)),
        this.context.extensionUri,
      ],
    };

    const imageData = await FileService.readFile(document.uri.fsPath);
    const imageBase64 = FileService.getImageBase64(
      imageData,
      document.uri.fsPath
    );

    webviewPanel.webview.html = WebviewContentGenerator.getImagePreviewContent(
      imageBase64,
      document.uri.fsPath
    );

    webviewPanel.webview.onDidReceiveMessage(
      async (message) => {
        if (message.command === 'openDiff') {
          await vscode.commands.executeCommand(
            'imageDiff.compareWithPrevious',
            document.uri
          );
        }
      },
      undefined,
      this.context.subscriptions
    );
  }
}

class WebviewContentGenerator {
  static getImagePreviewContent(imageBase64: string, filePath: string): string {
    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Image Preview</title>
          <style>
              body {
                  font-family: var(--vscode-font-family);
                  margin: 0;
                  padding: 0;
                  background-color: var(--vscode-editor-background);
                  color: var(--vscode-foreground);
                  height: 100vh;
                  display: flex;
                  flex-direction: column;
              }
              
              .header {
                  padding: 8px 12px;
                  background-color: var(--vscode-titleBar-activeBackground);
                  border-bottom: 1px solid var(--vscode-panel-border);
                  display: flex;
                  justify-content: space-between;
                  align-items: center;
              }
              
              .title {
                  font-size: 12px;
                  color: var(--vscode-descriptionForeground);
              }
              
              .diff-button {
                  padding: 4px 8px;
                  background-color: var(--vscode-button-background);
                  color: var(--vscode-button-foreground);
                  border: 1px solid var(--vscode-button-border);
                  border-radius: 2px;
                  cursor: pointer;
                  font-size: 11px;
                  font-family: var(--vscode-font-family);
                  display: flex;
                  align-items: center;
                  gap: 4px;
              }
              
              .diff-button:hover {
                  background-color: var(--vscode-button-hoverBackground);
              }
              
              .image-container {
                  flex: 1;
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  padding: 20px;
              }
              
              .image-container img {
                  max-width: 100%;
                  max-height: 100%;
                  object-fit: contain;
                  border: 1px solid var(--vscode-widget-border);
                  border-radius: 3px;
              }
          </style>
      </head>
      <body>
          <div class="header">
              <div class="title">${path.basename(filePath)}</div>
              <button class="diff-button" onclick="openDiff()">
                  <span>📊</span>
                  <span>Compare with Previous</span>
              </button>
          </div>
          
          <div class="image-container">
              <img src="${imageBase64}" alt="Image Preview">
          </div>
          
          <script>
              const vscode = acquireVsCodeApi();
              
              function openDiff() {
                  vscode.postMessage({ command: 'openDiff' });
              }
          </script>
      </body>
      </html>
    `;
  }

  static getDiffViewerContent(options: {
    currentImage: string;
    previousImage: string;
    diffImage: string | null;
    currentLabel: string;
    previousLabel: string;
  }): string {
    const {
      currentImage,
      previousImage,
      diffImage,
      currentLabel,
      previousLabel,
    } = options;

    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Image Pixel Diff</title>
          <style>
              * { box-sizing: border-box; }
              
              body {
                  font-family: var(--vscode-font-family);
                  font-size: var(--vscode-font-size);
                  padding: 0;
                  margin: 0;
                  background-color: var(--vscode-editor-background);
                  color: var(--vscode-foreground);
                  height: 100vh;
                  overflow: hidden;
              }
              
              .toolbar {
                  padding: 8px 12px;
                  background-color: var(--vscode-titleBar-activeBackground);
                  border-bottom: 1px solid var(--vscode-panel-border);
                  display: flex;
                  gap: 8px;
                  align-items: center;
                  flex-shrink: 0;
              }
              
              .toolbar-button {
                  padding: 4px 8px;
                  background-color: var(--vscode-button-background);
                  color: var(--vscode-button-foreground);
                  border: 1px solid var(--vscode-button-border);
                  border-radius: 2px;
                  cursor: pointer;
                  font-size: 11px;
                  font-family: var(--vscode-font-family);
                  min-width: 60px;
                  text-align: center;
                  transition: background-color 0.1s ease;
              }
              
              .toolbar-button:hover {
                  background-color: var(--vscode-button-hoverBackground);
              }
              
              .toolbar-button.active {
                  background-color: var(--vscode-button-secondaryBackground);
                  color: var(--vscode-button-secondaryForeground);
                  border-color: var(--vscode-focusBorder);
              }
              
              .container {
                  display: flex;
                  flex-direction: column;
                  height: calc(100vh - 41px);
              }
              
              .image-container {
                  flex: 1;
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  background-color: var(--vscode-editor-background);
                  position: relative;
                  overflow: hidden;
                  min-height: 0;
              }
              
              .side-by-side {
                  display: flex;
                  width: 100%;
                  height: 100%;
              }
              
              .side-by-side .image-panel {
                  flex: 1;
                  display: flex;
                  flex-direction: column;
                  align-items: center;
                  justify-content: center;
                  border-right: 1px solid var(--vscode-panel-border);
                  padding: 16px;
                  min-width: 0;
              }
              
              .side-by-side .image-panel:last-child {
                  border-right: none;
              }
              
              .image-panel h3 {
                  margin: 0 0 12px 0;
                  font-size: 12px;
                  font-weight: 600;
                  color: var(--vscode-descriptionForeground);
                  text-transform: uppercase;
                  letter-spacing: 0.5px;
              }
              
              .image-panel img {
                  max-width: 100%;
                  max-height: calc(100% - 30px);
                  object-fit: contain;
                  border: 1px solid var(--vscode-widget-border);
                  border-radius: 3px;
              }
              
              .slider-container {
                  position: relative;
                  width: 100%;
                  height: 100%;
                  overflow: hidden;
                  display: flex;
                  align-items: center;
                  justify-content: center;
              }
              
              .image-wrapper {
                  position: relative;
                  width: 100%;
                  height: 100%;
                  border: 1px solid var(--vscode-widget-border);
                  border-radius: 3px;
                  overflow: hidden;
              }
              
              .slider-container img {
                  display: block;
                  width: 100%;
                  height: 100%;
                  object-fit: contain;
              }
              
              .slider-container .previous-image {
                  position: absolute;
                  top: 0;
                  left: 0;
                  z-index: 1;
              }
              
              .slider-container .current-image {
                  position: absolute;
                  top: 0;
                  left: 0;
                  z-index: 2;
                  clip-path: polygon(50% 0%, 100% 0%, 100% 100%, 50% 100%);
              }
              
              .slider {
                  position: absolute;
                  top: 0;
                  left: 50%;
                  width: 2px;
                  height: 100%;
                  background-color: var(--vscode-focusBorder);
                  cursor: ew-resize;
                  z-index: 3;
                  transform: translateX(-50%);
              }
              
              .slider::before {
                  content: '';
                  position: absolute;
                  top: 50%;
                  left: 50%;
                  width: 12px;
                  height: 40px;
                  background-color: var(--vscode-focusBorder);
                  border-radius: 6px;
                  transform: translate(-50%, -50%);
                  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
              }
              
              .diff-container {
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  width: 100%;
                  height: 100%;
                  padding: 16px;
              }
              
              .diff-container img {
                  max-width: 100%;
                  max-height: 100%;
                  object-fit: contain;
                  border: 1px solid var(--vscode-widget-border);
                  border-radius: 3px;
              }
              
              .hidden { display: none !important; }
              
              .status-bar {
                  padding: 4px 12px;
                  background-color: var(--vscode-statusBar-background);
                  color: var(--vscode-statusBar-foreground);
                  border-top: 1px solid var(--vscode-panel-border);
                  font-size: 11px;
                  display: flex;
                  align-items: center;
                  gap: 16px;
                  flex-shrink: 0;
              }
              
              .status-item {
                  display: flex;
                  align-items: center;
                  gap: 4px;
              }
              
              .status-icon {
                  width: 12px;
                  height: 12px;
                  opacity: 0.8;
              }
          </style>
      </head>
      <body>
          <div class="toolbar">
              <button id="sideBySideBtn" class="toolbar-button active" onclick="setMode('sideBySide')">Side by Side</button>
              <button id="sliderBtn" class="toolbar-button" onclick="setMode('slider')">Swipe</button>
              ${
                diffImage
                  ? '<button id="diffBtn" class="toolbar-button" onclick="setMode(\'diff\')">Difference</button>'
                  : ''
              }
          </div>
          
          <div class="container">
              <div id="sideBySideMode" class="image-container">
                  <div class="side-by-side">
                      <div class="image-panel">
                          <h3>${previousLabel}</h3>
                          <img src="${previousImage}" alt="Previous Version">
                      </div>
                      <div class="image-panel">
                          <h3>${currentLabel}</h3>
                          <img src="${currentImage}" alt="Current Version">
                      </div>
                  </div>
              </div>
              
              <div id="sliderMode" class="image-container hidden">
                  <div class="slider-container">
                      <div class="image-wrapper">
                          <img class="previous-image" src="${previousImage}" alt="Previous Version">
                          <img class="current-image" src="${currentImage}" alt="Current Version">
                          <div class="slider" id="slider"></div>
                      </div>
                  </div>
              </div>
              
              ${
                diffImage
                  ? `
              <div id="diffMode" class="image-container hidden">
                  <div class="diff-container">
                      <img src="${diffImage}" alt="Diff Image">
                  </div>
              </div>
              `
                  : ''
              }
          </div>
          
          <div class="status-bar">
              <div class="status-item">
                  <span class="status-icon">📷</span>
                  <span>Image Comparison</span>
              </div>
              <div class="status-item">
                  <span class="status-icon">⚡</span>
                  <span>Drag slider to compare • Press 1/2/3 to switch modes</span>
              </div>
          </div>
          
          <script>
              let currentMode = 'sideBySide';
              let isDragging = false;
              
              function setMode(mode) {
                  document.querySelectorAll('.toolbar-button').forEach(btn => {
                      btn.classList.remove('active');
                  });
                  
                  if (mode === 'sideBySide') {
                      document.getElementById('sideBySideBtn').classList.add('active');
                  } else if (mode === 'slider') {
                      document.getElementById('sliderBtn').classList.add('active');
                  } else if (mode === 'diff') {
                      const diffBtn = document.getElementById('diffBtn');
                      if (diffBtn) diffBtn.classList.add('active');
                  }
                  
                  document.getElementById('sideBySideMode').classList.add('hidden');
                  document.getElementById('sliderMode').classList.add('hidden');
                  if (document.getElementById('diffMode')) {
                      document.getElementById('diffMode').classList.add('hidden');
                  }
                  
                  currentMode = mode;
                  if (mode === 'sideBySide') {
                      document.getElementById('sideBySideMode').classList.remove('hidden');
                  } else if (mode === 'slider') {
                      document.getElementById('sliderMode').classList.remove('hidden');
                  } else if (mode === 'diff') {
                      document.getElementById('diffMode').classList.remove('hidden');
                  }
              }
              
              const slider = document.getElementById('slider');
              const imageWrapper = document.querySelector('.image-wrapper');
              const currentImage = document.querySelector('.current-image');
              
              function updateSliderPosition(clientX) {
                  if (!imageWrapper) return;
                  
                  const rect = imageWrapper.getBoundingClientRect();
                  const x = clientX - rect.left;
                  const percentage = Math.max(0, Math.min(100, (x / rect.width) * 100));
                  
                  slider.style.left = percentage + '%';
                  currentImage.style.clipPath = \`polygon(\${percentage}% 0%, 100% 0%, 100% 100%, \${percentage}% 100%)\`;
              }
              
              if (slider) {
                  slider.addEventListener('mousedown', (e) => {
                      isDragging = true;
                      e.preventDefault();
                      document.body.style.cursor = 'ew-resize';
                  });
              }
              
              if (imageWrapper) {
                  imageWrapper.addEventListener('mousedown', (e) => {
                      if (currentMode === 'slider') {
                          isDragging = true;
                          updateSliderPosition(e.clientX);
                          document.body.style.cursor = 'ew-resize';
                      }
                  });
              }
              
              document.addEventListener('mousemove', (e) => {
                  if (!isDragging || currentMode !== 'slider') return;
                  updateSliderPosition(e.clientX);
              });
              
              document.addEventListener('mouseup', () => {
                  isDragging = false;
                  document.body.style.cursor = 'default';
              });
              
              document.querySelectorAll('img').forEach(img => {
                  img.addEventListener('dragstart', (e) => e.preventDefault());
              });
              
              document.addEventListener('keydown', (e) => {
                  if (e.key === '1') setMode('sideBySide');
                  else if (e.key === '2') setMode('slider');
                  else if (e.key === '3' && document.getElementById('diffMode')) setMode('diff');
              });
          </script>
      </body>
      </html>
    `;
  }
}

export function deactivate() {}

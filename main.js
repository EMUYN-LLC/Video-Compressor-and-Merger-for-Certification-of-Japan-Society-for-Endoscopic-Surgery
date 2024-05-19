// created by EMUYN LLC 2024-05-17
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  Menu,
  session,
  shell,
} = require("electron");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");

// 開発モードフラグ
const isDevMode = process.env.NODE_ENV === "development";
console.log("isDevMode: ", isDevMode);

const resourcesPath = isDevMode
  ? path.join(__dirname, "resources")
  : path.join(process.resourcesPath, "resources");
console.log("resourcesPath: ", resourcesPath);

const ffmpegPath = path.join(resourcesPath, "ffmpeg.exe");
console.log("ffmpegPath: ", ffmpegPath);

const today = new Date().toISOString().split("T")[0];

// 対応するファイル形式の正規表現
const videoFileExtensions = /\.(mp4|mov|avi|mkv|flv|wmv|vob|mpeg|mpg|mts)$/i;

// 入力ファイルの最大 bitrate
var maxBitrate = 0;

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: isDevMode ? 1200 : 800, // 開発モードでは広いウィンドウ
    height: 800,
    alwaysOnTop: true, // 起動時に最前面に表示
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      enableRemoteModule: false,
      sandbox: true,
    },
  });

  mainWindow.loadFile("index.html");

  // 開発モードの場合はデベロッパーツールを自動で開く
  if (isDevMode) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
    setTimeout(() => {
      mainWindow.setAlwaysOnTop(false); // 起動後に最前面表示を解除
    }, 1000); // 1秒後に解除、適宜時間を調整
  });
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null); // デフォルトメニューを削除

  // キャッシュをクリア
  session.defaultSession
    .clearCache()
    .then(() => {
      console.log("Cache cleared");
      createWindow();
    })
    .catch((err) => {
      console.error("Failed to clear cache:", err);
      createWindow();
    });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// ディレクトリ選択の共通ハンドラ
ipcMain.handle("select-directory", async () => {
  const result = await dialog.showOpenDialog({ properties: ["openDirectory"] });
  return result;
});

ipcMain.handle("get-directory-files", async (event, directoryPath) => {
  try {
    const files = fs
      .readdirSync(directoryPath)
      .filter((file) => videoFileExtensions.test(file));
    return files;
  } catch (error) {
    console.error("Error reading directory:", error);
    return [];
  }
});

function getMaxDurationFor2GB(maxBitrate) {
  const maxFileSizeInBytes = 2 * 1024 * 1024 * 1024; // 2GBのバイト数
  const bytesPerSecond = (maxBitrate * 1000) / 8;
  const maxDurationInSeconds = (maxFileSizeInBytes / bytesPerSecond) * 0.9; // 安全域 10%
  const hours = Math.floor(maxDurationInSeconds / 3600);
  const minutes = Math.floor((maxDurationInSeconds % 3600) / 60);
  const seconds = Math.floor(maxDurationInSeconds % 60);

  // hh:mm:ssの形式にフォーマット
  const hh = String(hours).padStart(2, "0");
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");

  return `${hh}:${mm}:${ss}`;
}

ipcMain.on(
  "compress-merge-videos",
  (
    event,
    {
      inputDirectoryPath,
      outputDirectoryPath,
      mergeWithoutCompression,
      resolution,
    }
  ) => {
    const outputPath = path.join(outputDirectoryPath, `merged_${today}.mp4`);
    const chunkedFolder = `chunked_${today}`;

    try {
      const inputFiles = fs
        .readdirSync(inputDirectoryPath)
        .filter((file) => videoFileExtensions.test(file))
        .map((file) => `file '${path.join(inputDirectoryPath, file)}'`)
        .join("\n");

      const inputFilePath = path.join(outputDirectoryPath, "input.txt");
      fs.writeFileSync(inputFilePath, inputFiles);
      console.log("fs.writeFileSync: ", inputFilePath, inputFiles);

      // full-list-of-ffmpeg-flags-and-options: https://gist.github.com/tayvano/6e2d456a9897f55025e25035478a3a50
      // -c codec: codec name (copy だとエンコードなし)
      // -fs limit_size: set the limit file size in bytes (分割の際は効果なし!)

      const resolutionOption =
        resolution === "1080p"
          ? "-vf scale=1920:1080 -b:v 8M"
          : "-vf scale=1280:720 -b:v 4M";
      const mergeCommand = mergeWithoutCompression
        ? `${ffmpegPath} -y -f concat -safe 0 -i "${inputFilePath}" -c copy "${outputPath}"`
        : `${ffmpegPath} -y -f concat -safe 0 -i "${inputFilePath}" ${resolutionOption} -c:v libx264 -preset fast -crf 22 -c:a aac -b:a 192k "${outputPath}"`;

      const segmentTime = mergeWithoutCompression
        ? getMaxDurationFor2GB(maxBitrate)
        : resolution === "1080p"
        ? "00:30:00"
        : "01:00:00";
      const splitCommand = `${ffmpegPath} -i ${outputPath} -y -f segment -segment_time ${segmentTime} -segment_list ${outputDirectoryPath}/${chunkedFolder}/playlist.txt -reset_timestamps 1 -c copy ${outputDirectoryPath}/${chunkedFolder}/chunked_${today}_%03d.mp4`;

      const cmd = `start cmd.exe /k "echo ${resourcesPath} & ${mergeCommand} & mkdir ${chunkedFolder} & ${splitCommand} & pause & exit"`;
      console.log("cmd: ", cmd);

      const process = spawn(cmd, { shell: true, cwd: outputDirectoryPath });

      process.on("error", (error) => {
        console.error("Failed to start subprocess:", error);
        event.reply(
          "video-processing-error",
          "FFmpegコマンドの実行中にエラーが発生しました: " + error.message
        );
      });

      process.on("exit", (code) => {
        if (code === 0) {
          event.reply(
            "video-processing-success",
            "ビデオ処理が正常に完了しました"
          );
        } else {
          event.reply(
            "video-processing-error",
            "FFmpegコマンドの実行中にエラーが発生しました。終了コード: " + code
          );
        }

        // バッチファイルを削除
        // fs.unlinkSync(batchFilePath);
      });
    } catch (error) {
      event.reply(
        "video-processing-error",
        "ビデオ処理中にエラーが発生しました: " + error.message
      );
    }
  }
);

ipcMain.on("analyze-videos", (event, inputDirectoryPath) => {
  try {
    const inputFiles = fs
      .readdirSync(inputDirectoryPath)
      .filter((file) => videoFileExtensions.test(file))
      .map((file) => path.join(inputDirectoryPath, file));

    // FFmpegで各ファイルのメタデータを取得してコンソールと<pre>に出力する
    maxBitrate = 0;
    inputFiles.forEach((file) => {
      const mergeCommand = `${ffmpegPath} -i "${file}" -hide_banner`;
      const process = spawn(mergeCommand, { shell: true });

      let stderrOutput = "";

      process.stderr.on("data", (data) => {
        stderrOutput += data.toString();
      });

      process.on("error", (error) => {
        console.error(`Failed to start subprocess for ${file}:`, error);
      });

      process.on("exit", (code) => {
        if (code === 0 || code === 1) {
          // FFmpeg returns 1 when no output file is specified
          // 正規表現を使用して必要な情報を抽出
          const durationMatch = stderrOutput.match(
            /Duration: (\d{2}:\d{2}:\d{2}.\d{2})/
          );
          const bitrateMatch = stderrOutput.match(/bitrate: (\d+ kb\/s)/);
          const codecMatch = stderrOutput.match(/Video: (\w+),/);
          const resolutionMatch = stderrOutput.match(/, (\d{3,5}x\d{3,5})/);
          const fpsMatch = stderrOutput.match(/, (\d{2}.\d{2} fps)/);

          const duration = durationMatch ? durationMatch[1] : "N/A";
          const bitrate = bitrateMatch ? bitrateMatch[1] : "N/A";
          if (bitrate !== "N/A") {
            const numericBitrate = parseFloat(bitrate);
            if (!isNaN(numericBitrate) && maxBitrate < numericBitrate) {
              maxBitrate = numericBitrate;
            }
          }

          const codec = codecMatch ? codecMatch[1] : "N/A";
          const resolution = resolutionMatch ? resolutionMatch[1] : "N/A";
          const fps = fpsMatch ? fpsMatch[1] : "N/A";
          const fileName = path.basename(file);

          const fileSizeInBytes = fs.statSync(file).size;
          const fileSizeInGB = (fileSizeInBytes / 1024 ** 3).toFixed(2);

          const metadata = `${fileName}\nDuration: ${duration}, Bitrate: ${bitrate}, Resolution: ${resolution}, Frame Rate: ${fps}, File Size: ${fileSizeInGB} GB\n---------------------------`;

          console.log(metadata);

          // <pre>要素に出力
          event.reply("metadata", metadata);
        } else {
          console.error(`FFmpeg process for ${file} exited with code: ${code}`);
        }
      });
    });
  } catch (error) {
    console.error("Error processing videos:", error);
  }
});

ipcMain.on("open-emuyn-page", () => {
  shell.openExternal("https://www.emuyn.net/");
});

ipcMain.on("open-emuyn-jsesv-page", () => {
  shell.openExternal("https://www.emuyn.net/jsesv/");
});

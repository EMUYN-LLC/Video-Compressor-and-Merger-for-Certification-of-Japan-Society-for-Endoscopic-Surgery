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

document.addEventListener("DOMContentLoaded", function () {
  const selectInputDirectoryButton = document.getElementById(
    "select-input-directory"
  );
  const selectOutputDirectoryButton = document.getElementById(
    "select-output-directory"
  );
  const startProcessButton = document.getElementById("start-process");
  const inputDirectoryField = document.getElementById("input-directory");
  const outputDirectoryField = document.getElementById("output-directory");
  const mergeWithoutCompressionCheckbox = document.getElementById(
    "mergeWithoutCompression"
  );
  const fileListPre = document.getElementById("file-list");
  const resolution1080p = document.getElementById("resolution1080p");
  const resolution720p = document.getElementById("resolution720p");

  // ボタンの初期状態を無効にする
  startProcessButton.disabled = true;

  // 入力ディレクトリ選択ボタンのイベントリスナー
  selectInputDirectoryButton.addEventListener("click", () => {
    window.electron
      .invoke("select-directory")
      .then((result) => {
        if (!result.canceled) {
          const inputDirPath = result.filePaths[0];
          inputDirectoryField.value = inputDirPath;
          checkDirectories();

          // 出力内容をクリア
          fileListPre.textContent = "";

          // ディレクトリが変更されたタイミングでFFmpegを使用してメタデータを取得
          window.electron.send("analyze-videos", inputDirPath);
        }
      })
      .catch((err) => {
        console.error("ディレクトリ選択中にエラーが発生しました:", err);
      });
  });

  // 出力ディレクトリ選択ボタンのイベントリスナー
  selectOutputDirectoryButton.addEventListener("click", () => {
    window.electron
      .invoke("select-directory")
      .then((result) => {
        if (!result.canceled) {
          outputDirectoryField.value = result.filePaths[0];
          checkDirectories();
        }
      })
      .catch((err) => {
        console.error("ディレクトリ選択中にエラーが発生しました:", err);
      });
  });

  // mergeWithoutCompression チェックボックスのイベントリスナー
  mergeWithoutCompressionCheckbox.addEventListener("change", () => {
    const disabled = mergeWithoutCompressionCheckbox.checked;
    resolution1080p.disabled = disabled;
    resolution720p.disabled = disabled;
  });

  // 圧縮・結合開始ボタンのイベントリスナー
  startProcessButton.addEventListener("click", () => {
    const inputDirectoryPath = inputDirectoryField.value;
    const outputDirectoryPath = outputDirectoryField.value;
    const mergeWithoutCompression = mergeWithoutCompressionCheckbox.checked;
    const resolution = resolution1080p.checked ? "1080p" : "720p";

    if (inputDirectoryPath && outputDirectoryPath) {
      startProcessButton.disabled = true; // ボタンを無効化して重複実行を防止

      window.electron.send("compress-merge-videos", {
        inputDirectoryPath,
        outputDirectoryPath,
        mergeWithoutCompression,
        resolution,
      });

      window.electron.receive("process-complete", (message) => {
        alert(message);
        startProcessButton.disabled = false; // ボタンを再度有効化
      });
    } else {
      console.error("入力ディレクトリと出力ディレクトリを選択してください");
    }
  });

  openEmuynPageButton.addEventListener("click", () => {
    window.electron.send("open-emuyn-jsesv-page");
  });

  emuynLogo.addEventListener("click", () => {
    window.electron.send("open-emuyn-page");
  });

  function checkDirectories() {
    const inputDirectoryPath = inputDirectoryField.value;
    const outputDirectoryPath = outputDirectoryField.value;
    startProcessButton.disabled = !(inputDirectoryPath && outputDirectoryPath);
  }

  // メタデータを表示するためのリスナー
  window.electron.receive("metadata", (metadata) => {
    fileListPre.textContent += metadata + "\n";
  });
});

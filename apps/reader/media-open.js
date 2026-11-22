// Files that open outside the note editor: audio plays in the global audio bar, video opens
// in the system player (or a new tab), and R data and scripts open in R Commander Studio
// (offering to set it up when it is not installed). Each is remembered in Recent.
// app.js wires it in with mediaOpener().
import { isAudioName, isRDataName, isVideoName } from "./text-types.js";
import { openNewRDialog } from "./math/new-r-dialog.js";

export function mediaOpener({ globalAudio, status, app }) {
  const isMp3Name = (name, type = "") => isAudioName(name, type);
  const isMp4Name = (name, type = "") => isVideoName(name, type);
  async function rememberMediaInRecent(file, { path = "", name = "", origin = "Imported" } = {}) {
    try {
      const fileName = file?.name || name || (path ? path.split(/[\\/]/).pop() : "");
      if (!fileName) return;
      if (path && app.library?.rememberLocal) {
        await app.library.rememberLocal(path, fileName, file?.size || 0);
      } else if (file && app.library?.rememberImported) {
        await app.library.rememberImported(file, { origin });
      }
      if (app.home?.visible) app.home.renderRecent?.();
    } catch { /* Best-effort Recent tracking. */ }
  }
  async function openExternalVideo(path, name = "video.mp4", file = null, { origin = "Imported" } = {}) {
    await rememberMediaInRecent(file, { path, name, origin });
    if (path && window.notecompleteFiles?.openExternalPath) {
      await window.notecompleteFiles.openExternalPath(path);
      status(`Opened ${name} in your system player.`);
      return true;
    }
    if (file) {
      const blobUrl = URL.createObjectURL(file.type ? file : new Blob([file], { type: "video/mp4" }));
      const opened = window.open(blobUrl, "_blank", "noopener,noreferrer");
      if (!opened) {
        const a = document.createElement("a");
        a.href = blobUrl;
        a.download = name;
        a.click();
      }
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
      status(`Opened ${name} in an external player.`);
      return true;
    }
    status(`Could not open ${name} in an external player.`, true);
    return true;
  }
  async function openRStudioTarget({ filePath = "", folderPath = "", title = "", code = "", kind = "r", embed = false } = {}) {
    if (!window.notecompleteRBridge) {
      status("R Commander Studio bridge requires the NoteComplete desktop app.", true);
      return false;
    }
    const res = await window.notecompleteRBridge.openInStudio({ filePath, folderPath, title, code, kind, embed });
    if (res?.ok) {
      status(res.connected ? "Opened in R Commander Studio." : "Launching R Commander Studio…");
      return true;
    }
    if (res?.notInstalled) {
      await openNewRDialog({
        status,
        onOpenStudio: openRStudioTarget,
        onCreatedWorkspace: async (created) => {
          if (created?.folderPath && created?.folderListing) {
            await app.groups.openFolder({ folder: created.folderPath, name: created.name, files: created.folderListing });
            app.home?.renderRecent?.();
          }
        },
        onCreatedFile: async (created) => {
          if (created?.filePath) {
            await app.library.rememberLocal(created.filePath, created.name, created.size || 0).catch(() => {});
            app.home?.renderRecent?.();
          }
        },
      });
      return true;
    }
    status(res?.error || "Could not open R Commander Studio.", true);
    return false;
  }
  async function openMediaFile(file, { path = "", origin = "Imported" } = {}) {
    if (!file) return false;
    if (isRDataName(file.name)) {
      await rememberMediaInRecent(file, { path, name: file.name, origin });
      await openRStudioTarget({ filePath: path, title: file.name });
      return true;
    }
    if (isMp3Name(file.name, file.type)) {
      await rememberMediaInRecent(file, { path, name: file.name, origin });
      await globalAudio.playFile(file);
      return true;
    }
    if (isMp4Name(file.name, file.type)) {
      return openExternalVideo(path, file.name, file, { origin });
    }
    return false;
  }
  return { isMp3Name, isMp4Name, openExternalVideo, openMediaFile, openRStudioTarget };
}

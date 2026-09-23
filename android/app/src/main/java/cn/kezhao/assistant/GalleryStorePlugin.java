package cn.kezhao.assistant;

import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.ContentValues;
import android.content.Context;
import android.content.IntentFilter;
import android.net.Uri;
import android.provider.MediaStore;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import android.content.Intent;
import android.provider.DocumentsContract;

import java.io.OutputStream;

/**
 * Local plugin: saves photos into the shared Pictures/<album>/ collection
 * via MediaStore (RELATIVE_PATH). Needs no storage permission on Android 10+,
 * and files survive app uninstall (unlike Android/media app-specific dirs).
 *
 * NOTE: keep this file ASCII-only. On Chinese Windows, javac's default GBK
 * decoding of UTF-8 doc comments can corrupt parsing (verified the hard way).
 */
@CapacitorPlugin(name = "GalleryStore")
public class GalleryStorePlugin extends Plugin {

    /** \u8bfe\u7167\u52a9\u624b = default gallery album name */
    private static final String DEFAULT_ALBUM = "\u8bfe\u7167\u52a9\u624b";

    private BroadcastReceiver downloadReceiver = null;
    private long pendingDownloadId = -1;

    /** Real status-bar height in px for the immersive layout (JS sets --status-bar-h). */
    @PluginMethod
    public void getStatusBarHeight(PluginCall call) {
        JSObject ret = new JSObject();
        int h = 0;
        if (getContext() instanceof MainActivity) {
            h = ((MainActivity) getContext()).getStatusBarInset();
        }
        ret.put("height", h);
        call.resolve(ret);
    }

    /**
     * In-app update download: uses the system DownloadManager (progress in the
     * notification bar), then opens the package installer when finished. This
     * replaces the old "open browser on GitHub" flow which users could not
     * complete (GitHub is unreachable on most CN phones, plus CORS blocks the
     * version check inside the WebView).
     */
    @PluginMethod
    public void downloadUpdate(PluginCall call) {
        String url = call.getString("url");
        if (url == null || !(url.startsWith("https://") || url.startsWith("http://"))) {
            call.reject("invalid url");
            return;
        }
        try {
            DownloadManager dm = (DownloadManager) getContext()
                    .getSystemService(Context.DOWNLOAD_SERVICE);
            DownloadManager.Request req = new DownloadManager.Request(Uri.parse(url));
            req.setTitle("\u8bfe\u7167\u52a9\u624b\u66f4\u65b0"); // app update
            req.setDestinationInExternalPublicDir(
                    android.os.Environment.DIRECTORY_DOWNLOADS, "kezhao-update.apk");
            req.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            req.setMimeType("application/vnd.android.package-archive");
            if (downloadReceiver == null) {
                downloadReceiver = new BroadcastReceiver() {
                    @Override
                    public void onReceive(Context context, Intent intent) {
                        long doneId = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1);
                        if (doneId != pendingDownloadId || pendingDownloadId == -1) return;
                        Uri fileUri = dm.getUriForDownloadedFile(doneId);
                        if (fileUri == null) return;
                        Intent install = new Intent(Intent.ACTION_VIEW);
                        install.setDataAndType(fileUri, "application/vnd.android.package-archive");
                        install.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK
                                | Intent.FLAG_GRANT_READ_URI_PERMISSION);
                        try {
                            getContext().startActivity(install);
                        } catch (Exception ignored) {
                            // First run on Android 8+: user must grant
                            // "install unknown apps" once; the system already
                            // showed the prompt, nothing else to do.
                        }
                    }
                };
                getContext().registerReceiver(downloadReceiver,
                        new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE));
            }
            pendingDownloadId = dm.enqueue(req);
            JSObject ret = new JSObject();
            ret.put("started", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("downloadUpdate failed: " + e.getMessage());
        }
    }

    @PluginMethod
    public void savePhoto(PluginCall call) {
        String dataUrl = call.getString("path");
        String fileName = call.getString("fileName");
        String album = call.getString("album", DEFAULT_ALBUM);
        if (dataUrl == null || !dataUrl.startsWith("data:")) {
            call.reject("path must be a data URL");
            return;
        }
        try {
            byte[] bytes = Base64.decode(dataUrl.substring(dataUrl.indexOf(",") + 1), Base64.DEFAULT);
            if (fileName == null || fileName.trim().isEmpty()) {
                fileName = "IMG_" + System.currentTimeMillis();
            }
            if (!fileName.toLowerCase().endsWith(".jpg") && !fileName.toLowerCase().endsWith(".jpeg")) {
                fileName = fileName + ".jpg";
            }
            String relativePath = "Pictures/" + album;

            // MediaStore insert renames on name collision ("x (1).jpg"), so drop our own
            // same-name file in the same folder first; makes re-sync idempotent.
            deleteOwnFiles(relativePath, fileName);

            ContentValues values = new ContentValues();
            values.put(MediaStore.Images.Media.DISPLAY_NAME, fileName);
            values.put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg");
            values.put(MediaStore.Images.Media.RELATIVE_PATH, relativePath);
            values.put(MediaStore.Images.Media.IS_PENDING, 1);
            Uri uri = getContext().getContentResolver()
                    .insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
            if (uri == null) {
                call.reject("MediaStore insert failed");
                return;
            }
            try (OutputStream os = getContext().getContentResolver().openOutputStream(uri)) {
                if (os == null) {
                    call.reject("openOutputStream failed");
                    return;
                }
                os.write(bytes);
            }
            ContentValues done = new ContentValues();
            done.put(MediaStore.Images.Media.IS_PENDING, 0);
            getContext().getContentResolver().update(uri, done, null, null);

            JSObject ret = new JSObject();
            ret.put("filePath", fileName);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("savePhoto failed: " + e.getMessage());
        }
    }

    /**
     * Deletes this app's own image files directly under the given album folder
     * (exact RELATIVE_PATH match, subfolders untouched). Returns the deleted count.
     * Used to migrate the flat album layout to per-subject subfolders.
     */
    @PluginMethod
    public void deleteAlbumFiles(PluginCall call) {
        String album = call.getString("album", DEFAULT_ALBUM);
        try {
            int deleted = deleteOwnFiles("Pictures/" + album, null);
            JSObject ret = new JSObject();
            ret.put("deleted", deleted);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("deleteAlbumFiles failed: " + e.getMessage());
        }
    }

    /**
     * Opens the photo location. Tries the Files app deep link first; many OEM
     * ROMs have no handler for it, so falls back to the system gallery (the
     * user's real goal is "see my photos"). Reports which path was taken.
     */
    @PluginMethod
    public void openFolder(PluginCall call) {
        String album = call.getString("album", DEFAULT_ALBUM);
        try {
            Uri docUri = DocumentsContract.buildDocumentUri(
                    "com.android.externalstorage.documents", "primary:Pictures/" + album);
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(docUri, DocumentsContract.Document.MIME_TYPE_DIR);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            getContext().startActivity(intent);
            JSObject ret = new JSObject();
            ret.put("via", "files");
            call.resolve(ret);
        } catch (Exception ignored) {
            try {
                Intent gallery = new Intent(Intent.ACTION_VIEW,
                        MediaStore.Images.Media.EXTERNAL_CONTENT_URI);
                gallery.setType("image/*");
                gallery.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(gallery);
                JSObject ret = new JSObject();
                ret.put("via", "gallery");
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("openFolder failed: " + e.getMessage());
            }
        }
    }

    /**
     * Deletes own-package image rows in the given relative path. When fileName is
     * provided only that display name is targeted; null means every own file there.
     * MediaStore stores RELATIVE_PATH with a trailing slash; normalize before matching.
     * Falls back to a path-only match for orphaned files (owner cleared by uninstall).
     */
    private int deleteOwnFiles(String relativePath, String fileName) {
        String normalized = relativePath.endsWith("/") ? relativePath : relativePath + "/";
        int deleted = deleteBySelection(normalized, fileName, true);
        if (deleted == 0) {
            deleted = deleteBySelection(normalized, fileName, false);
        }
        return deleted;
    }

    private int deleteBySelection(String normalizedPath, String fileName, boolean ownerOnly) {
        String selection = MediaStore.Images.Media.RELATIVE_PATH + "=?";
        java.util.List<String> args = new java.util.ArrayList<>();
        args.add(normalizedPath);
        if (ownerOnly) {
            selection += " AND " + MediaStore.Images.Media.OWNER_PACKAGE_NAME + "=?";
            args.add(getContext().getPackageName());
        }
        if (fileName != null) {
            selection += " AND " + MediaStore.Images.Media.DISPLAY_NAME + "=?";
            args.add(fileName);
        }
        try {
            return getContext().getContentResolver().delete(
                    MediaStore.Images.Media.EXTERNAL_CONTENT_URI, selection, args.toArray(new String[0]));
        } catch (SecurityException e) {
            return 0;
        }
    }
}

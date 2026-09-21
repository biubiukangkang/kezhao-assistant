package cn.kezhao.assistant;

import android.content.ContentValues;
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

    /** Opens the system Files app located at the album folder (external storage root). */
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
            call.resolve();
        } catch (Exception e) {
            call.reject("openFolder failed: " + e.getMessage());
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

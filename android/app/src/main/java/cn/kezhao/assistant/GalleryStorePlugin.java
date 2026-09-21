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

            ContentValues values = new ContentValues();
            values.put(MediaStore.Images.Media.DISPLAY_NAME, fileName);
            values.put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg");
            values.put(MediaStore.Images.Media.RELATIVE_PATH, "Pictures/" + album);
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
}

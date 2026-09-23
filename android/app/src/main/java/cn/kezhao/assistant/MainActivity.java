package cn.kezhao.assistant;

import android.os.Bundle;
import android.view.View;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 本地插件需在 super.onCreate 前注册
        registerPlugin(GalleryStorePlugin.class);
        super.onCreate(savedInstanceState);
        // WebView text zoom follows the system font scale by default; large-font
        // phones blow up the whole layout. National apps lock it to 100%.
        bridge.getWebView().getSettings().setTextZoom(100);
        // Edge-to-edge is enforced on targetSdk 35+, and the status-bar plugin's
        // setOverlaysWebView(false) is a no-op there. fitsSystemWindows is the
        // reliable way to keep content below the status bar on all ROMs.
        View content = findViewById(android.R.id.content);
        if (content != null) {
            content.setFitsSystemWindows(true);
        }
    }
}

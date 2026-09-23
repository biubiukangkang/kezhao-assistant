package cn.kezhao.assistant;

import android.os.Bundle;
import android.view.View;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    private int statusBarInset = 0;

    public int getStatusBarInset() {
        return statusBarInset;
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 本地插件需在 super.onCreate 前注册
        registerPlugin(GalleryStorePlugin.class);
        super.onCreate(savedInstanceState);
        // WebView text zoom follows the system font scale by default; large-font
        // phones blow up the whole layout. National apps lock it to 100%.
        bridge.getWebView().getSettings().setTextZoom(100);
        // WeChat-style immersive status bar: the bar stays transparent on top of
        // the page (edge-to-edge, no fitsSystemWindows pushing content down),
        // and the real bar height is exposed to JS (GalleryStore.getStatusBarHeight)
        // so pages pad themselves with the CSS variable --status-bar-h.
        View decor = getWindow().getDecorView();
        decor.setOnApplyWindowInsetsListener((v, insets) -> {
            statusBarInset = insets.getSystemWindowInsetTop();
            return insets;
        });
    }
}

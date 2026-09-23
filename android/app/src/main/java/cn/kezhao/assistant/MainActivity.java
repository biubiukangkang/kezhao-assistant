package cn.kezhao.assistant;

import android.os.Bundle;
import android.view.View;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    private int statusBarInset = 0;
    private int navBarInset = 0;

    public int getStatusBarInset() {
        return statusBarInset;
    }

    public int getNavBarInset() {
        return navBarInset;
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 本地插件需在 super.onCreate 前注册
        registerPlugin(GalleryStorePlugin.class);
        super.onCreate(savedInstanceState);
        // WebView text zoom follows the system font scale by default; large-font
        // phones blow up the whole layout. National apps lock it to 100%.
        bridge.getWebView().getSettings().setTextZoom(100);
        // WeChat-style immersive bars: status/nav bars stay transparent on top of
        // the page (edge-to-edge, no fitsSystemWindows), and the real inset
        // heights are exposed to JS in PHYSICAL px -- JS divides by
        // window.devicePixelRatio before using them as CSS px.
        View decor = getWindow().getDecorView();
        decor.setOnApplyWindowInsetsListener((v, insets) -> {
            statusBarInset = insets.getSystemWindowInsetTop();
            navBarInset = insets.getSystemWindowInsetBottom();
            return insets;
        });
    }
}

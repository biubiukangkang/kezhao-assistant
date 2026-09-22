package cn.kezhao.assistant;

import android.os.Bundle;

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
    }
}

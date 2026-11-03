package com.aura.music;

import android.os.Bundle;
import android.webkit.WebSettings;
import android.webkit.WebView;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AuraMediaPlugin.class);

        super.onCreate(savedInstanceState);

        // Desactivar el requisito de interacción de usuario para la reproducción multimedia.
        // Permite que la música continúe reproduciéndose automáticamente en segundo plano
        // al terminar una pista y pasar a la siguiente sin requerir tocar la pantalla.
        configureWebView();

        WindowCompat.enableEdgeToEdge(getWindow());

        WindowInsetsControllerCompat controller =
                WindowCompat.getInsetsController(
                        getWindow(),
                        getWindow().getDecorView()
                );

        if (controller == null) {
            return;
        }

        controller.setSystemBarsBehavior(
                WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        );

        controller.setAppearanceLightStatusBars(false);
        controller.setAppearanceLightNavigationBars(false);
        controller.hide(WindowInsetsCompat.Type.systemBars());

        getWindow().setNavigationBarContrastEnforced(false);
    }

    private void configureWebView() {
        if (getBridge() != null && getBridge().getWebView() != null) {
            try {
                WebView webView = getBridge().getWebView();
                WebSettings settings = webView.getSettings();
                settings.setMediaPlaybackRequiresUserGesture(false);
                settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
            } catch (Exception e) {
                android.util.Log.e("MainActivity", "Error configurando WebSettings", e);
            }
        }
    }

    @Override
    public void onResume() {
        super.onResume();
        configureWebView();
    }
}

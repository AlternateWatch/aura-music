package com.aura.music;

import android.os.Bundle;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        WindowCompat.enableEdgeToEdge(getWindow());

        WindowInsetsControllerCompat controller =
                WindowCompat.getInsetsController(
                        getWindow(),
                        getWindow().getDecorView()
                );

        if (controller == null) {
            return;
        }

        // Al deslizar desde los bordes, las barras aparecen
        // temporalmente y después vuelven a ocultarse.
        controller.setSystemBarsBehavior(
                WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        );

        // Iconos blancos cuando las barras estén visibles.
        controller.setAppearanceLightStatusBars(false);
        controller.setAppearanceLightNavigationBars(false);

        // Ocultar barra de estado + navegación.
        controller.hide(WindowInsetsCompat.Type.systemBars());

        // Evitar contraste adicional en navegación.
        getWindow().setNavigationBarContrastEnforced(false);
    }
}
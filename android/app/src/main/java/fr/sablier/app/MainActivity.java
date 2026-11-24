package fr.sablier.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Plugin maison : notification permanente pendant qu'un minuteur tourne.
        registerPlugin(TimerPlugin.class);
        super.onCreate(savedInstanceState);
    }
}

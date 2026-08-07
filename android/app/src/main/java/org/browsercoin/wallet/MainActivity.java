package org.browsercoin.wallet;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(BGKeepAlivePlugin.class);
        super.onCreate(savedInstanceState);
    }
}

package expo.modules.stresstwinkeyboard

import android.app.Activity
import android.content.Intent
import android.os.Bundle

/**
 * Android's IME framework expects `settingsActivity` (declared in method.xml)
 * to point at *something*. Rather than duplicate settings UI natively, this
 * just reopens the StressTwin app (deep-linked to Settings → Keyboard, which
 * is implemented in React Native) and finishes immediately.
 */
class StressTwinKeyboardSettingsActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val launch = packageManager.getLaunchIntentForPackage(packageName)?.apply {
            putExtra("stresstwin_deeplink", "stresstwin://settings/keyboard")
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        }
        if (launch != null) startActivity(launch)
        finish()
    }
}

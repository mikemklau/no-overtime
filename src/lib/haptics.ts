import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';

/**
 * Safe haptics wrapper for both native Capacitor apps and web browsers.
 */
export async function triggerHaptic(
  type: 'success' | 'warning' | 'error' | 'light' | 'medium'
) {
  try {
    switch (type) {
      case 'success':
        await Haptics.notification({ type: NotificationType.Success });
        break;
      case 'warning':
        await Haptics.notification({ type: NotificationType.Warning });
        break;
      case 'error':
        await Haptics.notification({ type: NotificationType.Error });
        break;
      case 'medium':
        await Haptics.impact({ style: ImpactStyle.Medium });
        break;
      case 'light':
      default:
        await Haptics.impact({ style: ImpactStyle.Light });
        break;
    }
  } catch {
    // Fallback for desktop/web browsers that support navigator.vibrate
    if (typeof window !== 'undefined' && 'vibrate' in navigator) {
      if (type === 'error') navigator.vibrate([100, 50, 100]);
      else if (type === 'warning') navigator.vibrate([80, 40, 80]);
      else navigator.vibrate(50);
    }
  }
}

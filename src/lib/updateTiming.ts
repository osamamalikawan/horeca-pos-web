/** First check for a desktop update, after the app has started and had time to sync. */
export const UPDATE_FIRST_CHECK_MS = 10_000;
/** Then look again this often. */
export const UPDATE_RECHECK_MS = 6 * 60 * 60 * 1000;
/**
 * Install by itself right after launch, but only if nobody has touched the app yet
 * and nothing is waiting to upload. Otherwise the user is asked (button in the sync popup).
 */
export const AUTO_INSTALL_AT_LAUNCH = true;

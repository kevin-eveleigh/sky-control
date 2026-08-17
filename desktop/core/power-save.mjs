/** Blocks App Nap and idle system sleep. Deliberately not
 *  "prevent-display-sleep": a menu-bar utility has no business lighting the
 *  screen, and the display sleeping does not interrupt the bridge. */
const ASSERTION = "prevent-app-suspension";

/** Holds at most one power assertion, and only while the bridge is actually
 *  running: an idle tray app has no reason to keep the Mac awake. */
export function createPowerSaveController({
  powerSaveBlocker,
  logger = { info() {}, error() {} },
  preferred = false,
}) {
  let wanted = preferred === true;
  let blockerId = null;

  const isActive = () => blockerId !== null && powerSaveBlocker.isStarted(blockerId);

  const release = () => {
    if (blockerId === null) return false;
    if (powerSaveBlocker.isStarted(blockerId)) powerSaveBlocker.stop(blockerId);
    blockerId = null;
    logger.info("Sleep prevention released.");
    return true;
  };

  return {
    get preferred() {
      return wanted;
    },
    isActive,
    setPreferred(value) {
      wanted = value === true;
      return wanted;
    },
    /** Reconciles the assertion with the preference and the bridge state. */
    apply(bridgeRunning) {
      if (wanted && bridgeRunning) {
        if (!isActive()) {
          blockerId = powerSaveBlocker.start(ASSERTION);
          logger.info("Sleep prevention active while the bridge runs.");
        }
      } else {
        release();
      }
      return isActive();
    },
    release,
  };
}

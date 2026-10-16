const DELAY_SCOPES = Object.freeze(['API', 'UI', 'BOTH']);
const DEFAULT_DELAY_SETTING = Object.freeze({ durationSeconds: 0, scope: 'BOTH' });

function isValidDelaySetting(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;

  const keys = Object.keys(value);
  return keys.length === 2
    && keys.includes('durationSeconds')
    && keys.includes('scope')
    && Number.isInteger(value.durationSeconds)
    && value.durationSeconds >= 0
    && value.durationSeconds <= 60
    && DELAY_SCOPES.includes(value.scope);
}

function createDelayService(initialSetting = DEFAULT_DELAY_SETTING) {
  if (!isValidDelaySetting(initialSetting)) {
    throw new TypeError('Initial delay setting must include an integer durationSeconds from 0 to 60 and a valid scope.');
  }

  let setting = { ...initialSetting };

  return {
    getDelaySetting() {
      return { ...setting };
    },

    setDelaySetting(nextSetting) {
      if (!isValidDelaySetting(nextSetting)) return null;
      setting = { ...nextSetting };
      return { ...setting };
    },
  };
}

module.exports = {
  DELAY_SCOPES,
  DEFAULT_DELAY_SETTING,
  createDelayService,
  isValidDelaySetting,
};

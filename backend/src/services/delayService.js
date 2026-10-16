const { randomUUID } = require('node:crypto');

const DELAY_SCOPES = Object.freeze(['API', 'UI', 'BOTH']);
const DEFAULT_DELAY_SETTING = Object.freeze({ minSeconds: 0, maxSeconds: 0, scope: 'BOTH' });
const DEFAULT_TICKET_TTL_MS = 2 * 60 * 1000;
const DEFAULT_MAX_TICKETS = 1000;

function isValidDelaySetting(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;

  const keys = Object.keys(value);
  return keys.length === 3
    && keys.includes('minSeconds')
    && keys.includes('maxSeconds')
    && keys.includes('scope')
    && Number.isInteger(value.minSeconds)
    && Number.isInteger(value.maxSeconds)
    && value.minSeconds >= 0
    && value.maxSeconds <= 60
    && value.minSeconds <= value.maxSeconds
    && DELAY_SCOPES.includes(value.scope);
}

function sampleInclusive(minSeconds, maxSeconds, random = Math.random) {
  const value = random();
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value >= 1) {
    throw new RangeError('Delay random source must return a number from 0 (inclusive) to 1 (exclusive).');
  }
  return minSeconds + Math.floor(value * (maxSeconds - minSeconds + 1));
}

function createDelayService(initialSetting = DEFAULT_DELAY_SETTING, {
  random = Math.random,
  now = Date.now,
  createTicketId = randomUUID,
  ticketTtlMs = DEFAULT_TICKET_TTL_MS,
  maxTickets = DEFAULT_MAX_TICKETS,
} = {}) {
  if (!isValidDelaySetting(initialSetting)) {
    throw new TypeError('Initial delay setting must include integer minSeconds and maxSeconds from 0 to 60, with minSeconds no greater than maxSeconds, and a valid scope.');
  }
  if (!Number.isInteger(ticketTtlMs) || ticketTtlMs <= 0 || !Number.isInteger(maxTickets) || maxTickets <= 0) {
    throw new TypeError('Delay ticket limits must be positive integers.');
  }

  let setting = { ...initialSetting };
  const tickets = new Map();

  function pruneTickets(currentTime = now()) {
    for (const [ticket, reservation] of tickets) {
      if (reservation.expiresAt <= currentTime) tickets.delete(ticket);
    }
    while (tickets.size >= maxTickets) {
      tickets.delete(tickets.keys().next().value);
    }
  }

  function sampleForApi() {
    if (setting.scope !== 'API' && setting.scope !== 'BOTH') return 0;
    return sampleInclusive(setting.minSeconds, setting.maxSeconds, random);
  }

  return {
    getDelaySetting() {
      return { ...setting };
    },

    setDelaySetting(nextSetting) {
      if (!isValidDelaySetting(nextSetting)) return null;
      setting = { ...nextSetting };
      return { ...setting };
    },

    sampleApiDelay() {
      return sampleForApi();
    },

    reserveApiDelay() {
      const currentTime = now();
      pruneTickets(currentTime);
      const ticket = createTicketId();
      if (typeof ticket !== 'string' || ticket.length === 0 || tickets.has(ticket)) {
        throw new Error('Delay ticket generator must return a unique non-empty string.');
      }
      const sampledSeconds = sampleForApi();
      tickets.set(ticket, { sampledSeconds, expiresAt: currentTime + ticketTtlMs });
      return { ticket, sampledSeconds };
    },

    consumeApiDelayTicket(ticket) {
      const currentTime = now();
      const reservation = tickets.get(ticket);
      if (!reservation) {
        pruneTickets(currentTime);
        return null;
      }
      tickets.delete(ticket);
      if (reservation.expiresAt <= currentTime) return null;
      return reservation.sampledSeconds;
    },
  };
}

module.exports = {
  DELAY_SCOPES,
  DEFAULT_DELAY_SETTING,
  DEFAULT_TICKET_TTL_MS,
  DEFAULT_MAX_TICKETS,
  createDelayService,
  isValidDelaySetting,
  sampleInclusive,
};

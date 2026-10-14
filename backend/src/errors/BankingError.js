class BankingError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'BankingError';
    this.status = status;
    this.code = code;
  }
}

module.exports = { BankingError };

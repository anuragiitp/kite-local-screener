export const ALERT_ATTRIBUTES = [
  { id: 'LastTradedPrice', label: 'Last price' },
];

export const ALERT_OPERATORS = ['>=', '>', '<=', '<', '=='];

const recentAlerts = new Map();

export function validateAlert(draft) {
  const errors = [];

  if (!draft?.lhs_tradingsymbol || !draft?.lhs_exchange) {
    errors.push('Symbol and exchange are required.');
  }

  if (!ALERT_ATTRIBUTES.some(({ id }) => id === draft?.lhs_attribute)) {
    errors.push('Invalid alert attribute.');
  }

  if (!ALERT_OPERATORS.includes(draft?.operator)) {
    errors.push('Invalid operator.');
  }

  const price = Number(draft?.rhs_constant);
  if (!Number.isFinite(price) || price <= 0) {
    errors.push('Alert price must be greater than 0.');
  }

  return errors;
}

export function alertFingerprint(alert) {
  return [
    alert?.lhs_exchange,
    alert?.lhs_tradingsymbol,
    alert?.lhs_attribute,
    alert?.operator,
    alert?.rhs_constant,
  ].join('|');
}

export function isDuplicateAlert(alert, windowMs = 4000) {
  const fp = alertFingerprint(alert);
  const last = recentAlerts.get(fp);
  return Boolean(last && Date.now() - last < windowMs);
}

export function markAlertCreated(alert) {
  recentAlerts.set(alertFingerprint(alert), Date.now());
}

import { getAuthHeaders } from './kiteApi';
import {
  isDuplicateAlert,
  markAlertCreated,
  validateAlert,
} from './alertSafety';

const ALERT_ENDPOINT = '/oms/alerts';

function encodeForm(data) {
  return Object.entries(data)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
}

export function buildAlert({
  exchange,
  tradingsymbol,
  lhs_attribute = 'LastTradedPrice',
  operator,
  rhs_constant,
  name,
}) {
  const price = Number(rhs_constant);
  const alertName = name || `${tradingsymbol} ${operator} ${price}`;

  return {
    name: alertName,
    type: 'simple',
    lhs_exchange: exchange,
    lhs_tradingsymbol: tradingsymbol,
    lhs_attribute,
    operator,
    rhs_type: 'constant',
    rhs_constant: price,
  };
}

export async function createAlert(alert) {
  const errors = validateAlert(alert);
  if (errors.length) {
    return { ok: false, blocked: true, errors, message: errors[0] };
  }

  if (isDuplicateAlert(alert)) {
    return { ok: false, blocked: true, message: 'Identical alert was just created. Duplicate blocked.' };
  }

  try {
    const response = await fetch(ALERT_ENDPOINT, {
      method: 'POST',
      credentials: 'include',
      headers: getAuthHeaders({
        'content-type': 'application/x-www-form-urlencoded',
        'x-kite-version': '3',
      }),
      body: encodeForm(alert),
    });

    const payload = await response.json().catch(() => null);

    if (!response.ok || payload?.status !== 'success') {
      return {
        ok: false,
        message: payload?.message || `Alert failed with HTTP ${response.status}`,
      };
    }

    markAlertCreated(alert);
    return {
      ok: true,
      alertId: payload?.data?.uuid,
      message: 'Alert created.',
      name: payload?.data?.name || alert.name,
    };
  } catch (error) {
    return { ok: false, message: error?.message || 'Network error creating alert.' };
  }
}

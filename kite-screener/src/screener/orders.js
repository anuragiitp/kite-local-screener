// The ONLY module allowed to place orders against the Kite OMS. Every call runs
// through validateOrder() + the duplicate/in-flight guards first, so no caller
// can bypass the safety layer.
import { getAuthHeaders, getUserId } from './kiteApi';
import {
  validateOrder,
  isDuplicateOrder,
  markOrderInFlight,
  markOrderSettled,
  hasInFlightOrder,
} from './orderSafety';

const ORDER_ENDPOINT = '/oms/orders/regular';

const ORDER_DEFAULTS = {
  variety: 'regular',
  validity: 'DAY',
  disclosed_quantity: 0,
  trigger_price: 0,
  squareoff: 0,
  stoploss: 0,
  trailing_stoploss: 0,
};

/** Build a normalized, whitelisted order payload from ticket input. */
export function buildOrder({
  exchange,
  tradingsymbol,
  transaction_type,
  product,
  order_type,
  quantity,
  price,
  trigger_price,
}) {
  const order = {
    ...ORDER_DEFAULTS,
    exchange,
    tradingsymbol,
    transaction_type,
    product,
    order_type,
    quantity: Number(quantity),
    user_id: getUserId(),
  };

  if (order_type === 'LIMIT') {
    order.price = Number(price);
  } else if (order_type === 'SL-M') {
    order.trigger_price = Number(trigger_price);
    order.price = 0;
  } else {
    order.price = 0;
  }

  return order;
}

function encodeForm(data) {
  return Object.entries(data)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
}

/**
 * Place a single order after passing all safety checks.
 * Returns { ok, orderId?, message?, errors?, warnings? }.
 *
 * @param {object} order  payload from buildOrder()
 * @param {object} ctx    { ltp, tickTime, allowWarnings }
 */
export async function placeOrder(order, ctx = {}) {
  const { errors, warnings } = validateOrder(order, ctx);

  if (errors.length) {
    return { ok: false, blocked: true, errors, warnings, message: errors[0] };
  }
  if (warnings.length && !ctx.allowWarnings) {
    return { ok: false, needsConfirm: true, errors, warnings, message: warnings[0] };
  }

  // Global single-flight + duplicate guard.
  if (hasInFlightOrder()) {
    return { ok: false, blocked: true, message: 'Another order is already being placed. Wait for it to finish.' };
  }
  if (isDuplicateOrder(order)) {
    return { ok: false, blocked: true, message: 'Identical order was just placed. Duplicate blocked.' };
  }

  markOrderInFlight(order);

  try {
    const response = await fetch(ORDER_ENDPOINT, {
      method: 'POST',
      credentials: 'include',
      headers: getAuthHeaders({
        'content-type': 'application/x-www-form-urlencoded',
        'x-kite-version': '3',
      }),
      body: encodeForm(order),
    });

    const payload = await response.json().catch(() => null);

    if (!response.ok || payload?.status !== 'success') {
      return {
        ok: false,
        message: payload?.message || `Order failed with HTTP ${response.status}`,
      };
    }

    return { ok: true, orderId: payload?.data?.order_id, message: 'Order placed.' };
  } catch (error) {
    return { ok: false, message: error?.message || 'Network error placing order.' };
  } finally {
    markOrderSettled(order);
  }
}

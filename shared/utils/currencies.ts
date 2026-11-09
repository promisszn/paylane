/**
 * Currencies PayPal can invoice in. https://developer.paypal.com/reference/currency-codes/
 * Anything else (NGN, INR, ZAR, KES, GHS...) is rejected by the Invoicing API, so
 * Paylane refuses it up front instead of saving a project that can never be billed.
 * RUB is left out: the API still accepts it, but PayPal suspended service in Russia.
 */
export const PAYPAL_CURRENCIES = [
  'AUD', 'BRL', 'CAD', 'CHF', 'CNY', 'CZK', 'DKK', 'EUR', 'GBP', 'HKD', 'HUF', 'ILS',
  'JPY', 'MXN', 'MYR', 'NOK', 'NZD', 'PHP', 'PLN', 'SEK', 'SGD', 'THB', 'TWD', 'USD',
] as const

export function paypalSupportsCurrency(code: string) {
  return (PAYPAL_CURRENCIES as readonly string[]).includes(code.trim().toUpperCase())
}

export function unsupportedCurrencyMessage(code: string) {
  return `PayPal can't invoice in ${code.trim().toUpperCase()}, so Paylane can't bill this deal. ` +
    'Restate the amounts in a currency PayPal supports, such as USD, EUR or GBP, and try again.'
}

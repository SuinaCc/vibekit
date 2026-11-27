import type { CurrencyResult } from '@shared';
import { DEFAULT_RATES, buildAliasIndex, type CurrencyDef } from '@shared/constants';

const aliasIndex = buildAliasIndex();

export function parseCurrencyQuery(query: string): { currency: CurrencyDef; amount: number } | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;

  // "100美元", "usd 100", "100 usd", "100$"
  const patterns = [
    /^(\d+(?:\.\d+)?)\s*([一-鿿\w$€£¥₩₹₱₦₫₺₽฿]+)$/,
    /^([一-鿿\w$€£¥₩₹₱₦₫₺₽฿]+)\s*(\d+(?:\.\d+)?)$/,
  ];

  for (const pattern of patterns) {
    const match = q.match(pattern);
    if (!match) continue;

    const a = match[1];
    const b = match[2];
    const numberPart = /^\d/.test(a) ? a : b;
    const aliasPart = /^\d/.test(a) ? b : a;
    const amount = parseFloat(numberPart);
    if (isNaN(amount) || amount <= 0) continue;

    let currency = aliasIndex.get(aliasPart);
    if (!currency) {
      currency = aliasIndex.get(aliasPart.replace(/[$€£¥₩₹₱₦₫₺₽฿]/g, ''));
    }
    if (currency && currency.code !== 'CNY') {
      return { currency, amount };
    }
  }

  return null;
}

export function convertCurrency(currency: CurrencyDef, amount: number): CurrencyResult {
  const rate = DEFAULT_RATES[currency.code] || 1;
  const result = amount / rate;
  const converted = Math.round(result * 100) / 100;
  const unitRate = Math.round((1 / rate) * 10000) / 10000;

  return {
    fromCode: currency.code,
    fromName: currency.name,
    fromSymbol: currency.symbol,
    amount,
    toCode: 'CNY',
    toSymbol: '¥',
    result: converted,
    rate: unitRate,
    updatedAt: 0,
    display: `${amount} ${currency.name} ≈ ¥${converted.toFixed(2)}`,
    subtitle: `汇率 1 ${currency.code} = ${unitRate.toFixed(4)} CNY（内置默认汇率）`,
  };
}

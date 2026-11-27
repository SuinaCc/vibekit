// ~35 common currencies with Chinese aliases
export interface CurrencyDef {
  code: string;        // ISO 4217
  symbol: string;      // e.g. $, €, ¥
  name: string;        // Chinese name
  aliases: string[];   // Chinese aliases for matching
}

export const CURRENCIES: CurrencyDef[] = [
  { code: 'CNY', symbol: '¥', name: '人民币', aliases: ['人民币', '元', '块'] },
  { code: 'USD', symbol: '$', name: '美元', aliases: ['美元', '美金', '美刀', '刀'] },
  { code: 'EUR', symbol: '€', name: '欧元', aliases: ['欧元', '欧'] },
  { code: 'JPY', symbol: '¥', name: '日元', aliases: ['日元', '日币'] },
  { code: 'GBP', symbol: '£', name: '英镑', aliases: ['英镑'] },
  { code: 'HKD', symbol: 'HK$', name: '港币', aliases: ['港币', '港元'] },
  { code: 'KRW', symbol: '₩', name: '韩元', aliases: ['韩元', '韩币'] },
  { code: 'TWD', symbol: 'NT$', name: '新台币', aliases: ['新台币', '台币', '新台'] },
  { code: 'AUD', symbol: 'A$', name: '澳元', aliases: ['澳元', '澳币'] },
  { code: 'SGD', symbol: 'S$', name: '新加坡元', aliases: ['新加坡元', '新币', '坡币'] },
  { code: 'THB', symbol: '฿', name: '泰铢', aliases: ['泰铢'] },
  { code: 'MYR', symbol: 'RM', name: '马来西亚林吉特', aliases: ['马来西亚林吉特', '马币', '林吉特'] },
  { code: 'PHP', symbol: '₱', name: '菲律宾比索', aliases: ['菲律宾比索', '比索'] },
  { code: 'IDR', symbol: 'Rp', name: '印尼盾', aliases: ['印尼盾', '印尼卢比'] },
  { code: 'INR', symbol: '₹', name: '印度卢比', aliases: ['印度卢比', '卢比'] },
  { code: 'CAD', symbol: 'C$', name: '加拿大元', aliases: ['加拿大元', '加元', '加币'] },
  { code: 'CHF', symbol: 'Fr', name: '瑞士法郎', aliases: ['瑞士法郎', '法郎', '瑞郎', '瑞法'] },
  { code: 'MOP', symbol: 'MOP$', name: '澳门元', aliases: ['澳门元', '澳门币', '葡币', '澳币'] },
  { code: 'NZD', symbol: 'NZ$', name: '新西兰元', aliases: ['新西兰元', '纽元', '纽币'] },
  { code: 'SEK', symbol: 'kr', name: '瑞典克朗', aliases: ['瑞典克朗', '克朗'] },
  { code: 'NOK', symbol: 'kr', name: '挪威克朗', aliases: ['挪威克朗'] },
  { code: 'DKK', symbol: 'kr', name: '丹麦克朗', aliases: ['丹麦克朗'] },
  { code: 'RUB', symbol: '₽', name: '俄罗斯卢布', aliases: ['俄罗斯卢布', '卢布'] },
  { code: 'BRL', symbol: 'R$', name: '巴西雷亚尔', aliases: ['巴西雷亚尔', '雷亚尔'] },
  { code: 'ZAR', symbol: 'R', name: '南非兰特', aliases: ['南非兰特', '兰特'] },
  { code: 'TRY', symbol: '₺', name: '土耳其里拉', aliases: ['土耳其里拉', '里拉'] },
  { code: 'AED', symbol: 'د.إ', name: '阿联酋迪拉姆', aliases: ['阿联酋迪拉姆', '迪拉姆', '迪'] },
  { code: 'SAR', symbol: '﷼', name: '沙特里亚尔', aliases: ['沙特里亚尔', '里亚尔'] },
  { code: 'MXN', symbol: 'Mex$', name: '墨西哥比索', aliases: ['墨西哥比索', '墨比索'] },
  { code: 'PLN', symbol: 'zł', name: '波兰兹罗提', aliases: ['波兰兹罗提'] },
  { code: 'CZK', symbol: 'Kč', name: '捷克克朗', aliases: ['捷克克朗'] },
  { code: 'VND', symbol: '₫', name: '越南盾', aliases: ['越南盾', '越盾'] },
  { code: 'NGN', symbol: '₦', name: '尼日利亚奈拉', aliases: ['尼日利亚奈拉', '奈拉'] },
  { code: 'EGP', symbol: 'E£', name: '埃及镑', aliases: ['埃及镑'] },
  { code: 'ARS', symbol: 'AR$', name: '阿根廷比索', aliases: ['阿根廷比索', '阿比索'] },
];

// Built-in fallback rates (1 CNY = ?)
// Updated 2026-06
export const DEFAULT_RATES: Record<string, number> = {
  CNY: 1,
  USD: 0.1379,
  EUR: 0.1276,
  JPY: 20.58,
  GBP: 0.1087,
  HKD: 1.079,
  KRW: 190.8,
  TWD: 4.516,
  AUD: 0.2132,
  SGD: 0.1865,
  THB: 4.901,
  MYR: 0.6467,
  PHP: 7.918,
  IDR: 2264,
  INR: 11.85,
  CAD: 0.1914,
  CHF: 0.1248,
  MOP: 1.111,
  NZD: 0.2325,
  SEK: 1.488,
  NOK: 1.473,
  DKK: 0.9523,
  RUB: 12.51,
  BRL: 0.7539,
  ZAR: 2.539,
  TRY: 5.132,
  AED: 0.5066,
  SAR: 0.5173,
  MXN: 2.628,
  PLN: 0.5511,
  CZK: 3.203,
  VND: 3560,
  NGN: 219.1,
  EGP: 6.995,
  ARS: 187.4,
};

// Build index: alias -> CurrencyDef
export function buildAliasIndex(): Map<string, CurrencyDef> {
  const idx = new Map<string, CurrencyDef>();
  for (const c of CURRENCIES) {
    idx.set(c.code.toLowerCase(), c);
    for (const alias of c.aliases) {
      idx.set(alias.toLowerCase(), c);
    }
  }
  return idx;
}

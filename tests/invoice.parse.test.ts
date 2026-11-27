import { describe, it, expect } from 'vitest';
import {
  money,
  invoiceNo,
  issueDate,
  seller,
  sellerPhone,
  hotelDisplayName,
  classify,
  parseTrain,
  normHub,
  splitFromTo,
  parseTrips,
  tripTotal,
  isTripFile,
  normalizeConfig,
  buildRows,
  assignNumbers,
  makeOutName,
  round2,
  type InvoiceRecord,
} from '../src/main/services/invoice/parse';

const SELF = normalizeConfig({ selfKeywords: ['中航信'] } as never);

describe('money 金额提取', () => {
  it('提取 ¥ 后金额并取最大值', () => {
    expect(money('价税合计 ¥102.40 小写 ¥102.40')).toBe(102.4);
  });
  it('支持 ￥ 与逗号千分位', () => {
    expect(money('￥1,234.56')).toBe(1234.56);
  });
  it('金额在后缀位置', () => {
    expect(money('102.40¥')).toBe(102.4);
  });
  it('票价前缀兜底', () => {
    expect(money('票价：55.00')).toBe(55);
  });
  it('（小写）兜底', () => {
    expect(money('（小写）¥88.00')).toBe(88);
  });
  it('无金额返回 null', () => {
    expect(money('没有金额')).toBeNull();
  });
});

describe('invoiceNo 票号提取', () => {
  it('标准发票号码字段', () => {
    expect(invoiceNo('发票号码: 24312000000123456789')).toBe('24312000000123456789');
  });
  it('20 位数字兜底且不误判长串', () => {
    expect(invoiceNo('编号 12345678901234567890 结束')).toBe('12345678901234567890');
    expect(invoiceNo('21位 123456789012345678901')).toBe('');
  });
  it('字段名含空格', () => {
    expect(invoiceNo('发 票 号 码：11122233344455566677')).toBe('11122233344455566677');
  });
});

describe('issueDate 开票日期', () => {
  it('开票日期字段优先', () => {
    expect(issueDate('开票日期:2026年3月5日')).toEqual({ y: 2026, m: 3, d: 5 });
  });
  it('普通日期兜底', () => {
    expect(issueDate('2025年12月31日')).toEqual({ y: 2025, m: 12, d: 31 });
  });
  it('无日期返回 null', () => {
    expect(issueDate('没有日期')).toBeNull();
  });
});

describe('seller 销售方提取', () => {
  it('双方都有公司时取最后一个（销售方）', () => {
    expect(seller('购买方：杭州研究所有限公司 销售方：汉庭酒店浙江杭州上城区有限公司', SELF)).toBe('汉庭酒店浙江杭州上城区有限公司');
  });
  it('selfKeywords 排除购买方', () => {
    expect(seller('中航信科技有限公司 汉庭酒店杭州有限公司', normalizeConfig({ selfKeywords: ['中航信'] } as never))).toBe('汉庭酒店杭州有限公司');
  });
  it('排除银行/信用社', () => {
    expect(seller('工商银行杭州分行营业部 汉庭酒店杭州有限公司', SELF)).toBe('汉庭酒店杭州有限公司');
  });
});

describe('sellerPhone 销售方电话', () => {
  it('双方都有电话时取最后一处（销售方）', () => {
    const text = '地、电话：0571-11112222\n地址、电话：杭州市上城区 0571-87654321';
    expect(sellerPhone(text)).toBe('0571-87654321');
  });
  it('12 位无横线座机重排', () => {
    expect(sellerPhone('地址、电话：057187654321')).toBe('0571-87654321');
  });
  it('400 电话（有横线原样保留，无横线不做座机重排）', () => {
    expect(sellerPhone('地址、电话：400-123-4567')).toBe('400-123-4567');
    expect(sellerPhone('地址、电话：4001234567')).toBe('4001234567');
  });
  it('手机号兜底', () => {
    expect(sellerPhone('地址、电话：13812345678')).toBe('13812345678');
  });
  it('20 位票号不误判为电话', () => {
    expect(sellerPhone('发票号码 24312000000123456789 地址、电话：0571-87654321')).toBe('0571-87654321');
  });
  it('无电话返回空', () => {
    expect(sellerPhone('没有任何联系方式')).toBe('');
  });
});

describe('hotelDisplayName 酒店名', () => {
  it('销售方去法律后缀', () => {
    expect(hotelDisplayName({ seller: '汉庭酒店浙江杭州上城区有限公司', raw: '' })).toBe('汉庭酒店浙江杭州上城区');
  });
  it('分公司后缀', () => {
    expect(hotelDisplayName({ seller: '如家酒店杭州西湖大道分公司', raw: '' })).toBe('如家酒店杭州西湖大道');
  });
  it('销售方缺失时从原文抓门店名', () => {
    expect(hotelDisplayName({ seller: '', raw: '入住：汉庭酒店杭州武林广场店' })).toBe('汉庭酒店杭州武林广场店');
  });
  it('原文兜底抓酒店字样', () => {
    expect(hotelDisplayName({ seller: '', raw: '住宿服务 亚朵酒店' })).toBe('亚朵酒店');
  });
});

describe('classify 分类', () => {
  it('火车票（内容）', () => {
    expect(classify('中国铁路 12306 电子客票 G594 车次')).toBe('train');
  });
  it('火车票（文件名）', () => {
    expect(classify('随便', '铁路客票.pdf')).toBe('train');
  });
  it('滴滴打车', () => {
    expect(classify('DIDI TRAVEL 行程单')).toBe('didi');
  });
  it('网约车服务', () => {
    expect(classify('网约车运输服务')).toBe('didi');
  });
  it('机票代订', () => {
    expect(classify('代订机票经纪代理服务')).toBe('flight');
  });
  it('酒店住宿', () => {
    expect(classify('住宿服务*住宿费')).toBe('hotel');
  });
  it('其他', () => {
    expect(classify('办公用品')).toBe('other');
  });
});

describe('parseTrain 火车票', () => {
  it('站名在后、车次在后的版式', () => {
    const [date, from, to, no, seat] = parseTrain('2026年3月5日08:15开 杭州西站 汉口站 G594 二等座');
    expect(date).toEqual({ y: 2026, m: 3, d: 5 });
    expect(from).toBe('杭州西站');
    expect(to).toBe('汉口站');
    expect(no).toBe('G594');
    expect(seat).toBe('二等座');
  });
  it('车次在中间的版式', () => {
    const [, from, to, no] = parseTrain('杭州东 G7358 武汉站');
    expect(from).toBe('杭州东');
    expect(no).toBe('G7358');
    expect(to).toBe('武汉站');
  });
});

describe('normHub 枢纽简称', () => {
  it('去掉城市前缀（非东南西北站）', () => {
    expect(normHub('上海虹桥站')).toBe('虹桥站');
    expect(normHub('汉口站')).toBe('汉口站');
  });
  it('东南西北站保留前缀', () => {
    expect(normHub('杭州东站')).toBe('杭州东站');
    expect(normHub('杭州西站')).toBe('杭州西站');
  });
});

describe('splitFromTo 起终点切分', () => {
  it('双竖线地址', () => {
    const [from, to] = splitFromTo('光谷步行街|街道口地铁站');
    expect(from).toContain('光谷步行街');
    expect(to).toContain('街道口地铁站');
  });
  it('空格分隔兜底', () => {
    const [from, to] = splitFromTo('杭州东站 西湖景区');
    expect(from).toBe('杭州东站');
    expect(to).toBe('西湖景区');
  });
});

describe('tripTotal / isTripFile', () => {
  it('合计金额', () => {
    expect(tripTotal('合计 123.45 元')).toBe(123.45);
  });
  it('行程单识别', () => {
    expect(isTripFile('DIDI TRAVEL', 'x.pdf')).toBe(true);
    expect(isTripFile('普通发票', '我的行程单.pdf')).toBe(true);
    expect(isTripFile('普通发票', '发票.pdf')).toBe(false);
  });
});

describe('parseTrips 滴滴行程单', () => {
  it('解析多段行程', () => {
    const text = [
      '03-05 08:15 周四 光谷广场|街道口 4.2 12.50',
      '03-05 18:30 周四 街道口|光谷广场 4.3 13.00',
    ].join('\n');
    const trips = parseTrips(text);
    expect(trips.length).toBe(2);
    expect(trips[0].amount).toBe(12.5);
    expect(trips[1].amount).toBe(13);
    expect(trips[0].from).toBe('光谷广场');
    expect(trips[0].to).toBe('街道口');
    expect(trips[0].date).toBe('03-05');
  });
});

describe('normalizeConfig', () => {
  it('解析地名别名（含数组键）', () => {
    const config = normalizeConfig({ places: [[['杭电', '杭州电子科大'], '研究所'], ['汉庭', '酒店']] } as never);
    expect(config.places.length).toBe(2);
    expect(config.places[0].keys).toEqual(['杭电', '杭州电子科大']);
    expect(config.places[0].alias).toBe('研究所');
  });
  it('noteOverrides 仅保留字符串值', () => {
    const config = normalizeConfig({ noteOverrides: { 1: '手写备注', bad: 42 } } as never);
    expect(config.noteOverrides).toEqual({ '1': '手写备注' });
  });
  it('cities 缺省时用内置城市表', () => {
    expect(normalizeConfig(undefined).cities.length).toBeGreaterThan(3);
  });
});

describe('noteOverrides 备注覆写', () => {
  function hotelInvoice(no: string, amount: number): InvoiceRecord {
    return {
      file: `${no}.pdf`,
      path: `/tmp/${no}.pdf`,
      folder: '/tmp',
      mtimeMs: 0,
      size: 0,
      kind: 'hotel',
      amount,
      date: { y: 2026, m: 3, d: 5 },
      no,
      seller: '汉庭酒店杭州有限公司',
      tel: '0571-87654321',
      raw: '',
      trip: null,
    };
  }
  it('覆写后的备注写入行', () => {
    const invoices = [hotelInvoice('A1', 100)];
    const { periods } = assignNumbers(invoices);
    const config = normalizeConfig({ noteOverrides: { '1': '客户A · 酒店住宿' } } as never);
    const rows = buildRows(invoices, periods, config);
    expect(rows[0].note).toBe('客户A · 酒店住宿');
  });
  it('无覆写时保留自动备注（酒店名 + 电话）', () => {
    const invoices = [hotelInvoice('A1', 100)];
    const { periods } = assignNumbers(invoices);
    const rows = buildRows(invoices, periods, normalizeConfig(undefined));
    expect(rows[0].note).toBe('汉庭酒店杭州 0571-87654321');
  });
});

describe('makeOutName 输出文件名', () => {
  it('含工号与日期区间', () => {
    const name = makeOutName('E123', [{ y: 2026, m: 3, d: 5 }, { y: 2026, m: 3, d: 9 }], '张三', '杭州');
    expect(name).toBe('E123 2026-03-05-~2026-03-09张三杭州出差报销单.xlsx');
  });
  it('区间缺失返回 null', () => {
    expect(makeOutName('E123', [null, null], '张三', '')).toBeNull();
  });
});

describe('round2', () => {
  it('避免浮点误差', () => {
    expect(round2(0.1 + 0.2)).toBe(0.3);
  });
});

import { describe, expect, it } from 'vitest';
import { aggregateFocusByHour, computeWaterGoal, emptyDailyStats } from '../src/shared/types/pomodoro';

describe('aggregateFocusByHour 专注时段分布', () => {
  it('跨天累加到 24 个槽位', () => {
    const a = emptyDailyStats('2026-11-26');
    a.focusByHour[9] = 25;
    a.focusByHour[14] = 50;
    const b = emptyDailyStats('2026-11-27');
    b.focusByHour[9] = 75;
    const out = aggregateFocusByHour([a, b]);
    expect(out.length).toBe(24);
    expect(out[9]).toBe(100);
    expect(out[14]).toBe(50);
    expect(out[8]).toBe(0);
  });

  it('容忍畸形数据（长度不对/非数字）', () => {
    const bad = { focusByHour: [1, 2, 3] as unknown as number[] }; // length 3, not 24
    const good = emptyDailyStats('2026-11-27');
    good.focusByHour[23] = 10;
    const out = aggregateFocusByHour([bad, good]);
    expect(out[23]).toBe(10);
    expect(out.reduce((s, n) => s + n, 0)).toBe(10);
  });

  it('空列表返回全零', () => {
    const out = aggregateFocusByHour([]);
    expect(out.every((v) => v === 0)).toBe(true);
  });
});

describe('computeWaterGoal 饮水目标', () => {
  it('默认身高体重给出合理目标', () => {
    const goal = computeWaterGoal(170, 65);
    expect(goal).toBeGreaterThanOrEqual(1200);
    expect(goal).toBeLessThanOrEqual(4000);
    expect(goal % 50).toBe(0);
  });

  it('越大体重目标越高', () => {
    expect(computeWaterGoal(170, 90)).toBeGreaterThan(computeWaterGoal(170, 55));
  });

  it('边界输入被钳制', () => {
    expect(computeWaterGoal(0, 0)).toBe(computeWaterGoal(100, 30));
  });
});

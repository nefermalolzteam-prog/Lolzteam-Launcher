import { ITEM_ORIGINS, originsForCategory } from '@shared-types';
import { describe, expect, it } from 'vitest';

/**
 * The market refuses an edit naming an origin its category does not accept, so
 * these lists mirror the forum's own per-platform rules.
 */
describe('originsForCategory', () => {
  it('незнакомая категория получает общий список без «служебных» значений', () => {
    const list = originsForCategory('roblox');
    expect(list).toEqual(['brute', 'phishing', 'stealer', 'personal', 'resale', 'autoreg']);
  });

  it('Steam добавляет пустышку и возврат через поддержку', () => {
    const list = originsForCategory('steam');
    expect(list).toContain('dummy');
    expect(list).toContain('retrieve_via_support');
  });

  it('у Telegram нет брута, зато есть саморег', () => {
    const list = originsForCategory('telegram');
    expect(list).not.toContain('brute');
    expect(list).toContain('self_registration');
  });

  it('у Discord нет брута, у Battlenet — фишинга', () => {
    expect(originsForCategory('discord')).not.toContain('brute');
    expect(originsForCategory('battlenet')).not.toContain('phishing');
  });

  it('VK — единственная категория с «возвратом»', () => {
    expect(originsForCategory('vk')).toContain('retrieve');
    expect(originsForCategory('steam')).not.toContain('retrieve');
  });

  it('регистр категории роли не играет', () => {
    expect(originsForCategory('Steam')).toEqual(originsForCategory('steam'));
  });

  it('категории может не быть вовсе', () => {
    expect(originsForCategory(null)).toEqual(originsForCategory('unknown'));
  });

  it('текущее значение лота остаётся в списке, даже если категория его не предлагает', () => {
    const list = originsForCategory('discord', 'brute');
    expect(list).toContain('brute');
    expect(list.filter((o) => o === 'brute')).toHaveLength(1);
  });

  it('каждое значение категории известно общему списку', () => {
    for (const category of ['steam', 'telegram', 'discord', 'vk', 'fortnite', 'battlenet', 'x']) {
      for (const origin of originsForCategory(category)) {
        expect(ITEM_ORIGINS).toContain(origin);
      }
    }
  });
});

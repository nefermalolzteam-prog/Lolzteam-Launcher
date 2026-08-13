import type { MailLetter } from '@shared-types';
import { describe, expect, it } from 'vitest';
import {
  countCodes,
  dateBucket,
  emailOf,
  filterLetters,
  findCode,
  joinCredentials,
  letterFacts,
  matchesQuery,
  splitCredentials,
  tidyPlainText,
} from '../mailRules';

const letter = (over: Partial<MailLetter> = {}): MailLetter => ({
  id: 'l1',
  subject: null,
  from: null,
  to: null,
  date: null,
  textPlain: null,
  textHtml: null,
  ...over,
});

describe('splitCredentials', () => {
  it('делит по первому двоеточию', () => {
    expect(splitCredentials('user@mail.ru:hunter2')).toEqual({
      email: 'user@mail.ru',
      password: 'hunter2',
    });
  });

  it('оставляет двоеточия внутри пароля', () => {
    expect(splitCredentials('user@mail.ru:a:b:c')).toEqual({
      email: 'user@mail.ru',
      password: 'a:b:c',
    });
  });

  it('обрезает пробелы вокруг адреса, но не внутри пароля', () => {
    expect(splitCredentials('  user@mail.ru: pw ')).toEqual({
      email: 'user@mail.ru',
      password: ' pw',
    });
  });

  it('отказывается от строк без пары', () => {
    expect(splitCredentials('user@mail.ru')).toBeNull();
    expect(splitCredentials('user@mail.ru:')).toBeNull();
    expect(splitCredentials(':pw')).toBeNull();
    expect(splitCredentials('')).toBeNull();
  });

  it('переживает обратную сборку', () => {
    const c = { email: 'a@b.c', password: 'p:w' };
    expect(splitCredentials(joinCredentials(c))).toEqual(c);
  });
});

describe('emailOf', () => {
  it('показывает адрес и прячет пароль', () => {
    expect(emailOf('user@mail.ru:hunter2')).toBe('user@mail.ru');
  });

  it('возвращает строку целиком, если пароля в ней нет', () => {
    expect(emailOf(' user@mail.ru ')).toBe('user@mail.ru');
  });
});

describe('findCode', () => {
  it('берёт число рядом со словом о коде', () => {
    expect(findCode(null, 'Enter this temporary verification code: 564835')).toBe('564835');
  });

  it('видит подсказку справа от числа', () => {
    expect(findCode(null, '186425 — ваш код подтверждения')).toBe('186425');
  });

  it('дотягивается до подсказки в теме, когда в теле голое число', () => {
    expect(findCode('Код подтверждения ChatGPT', '\n\n123456\n\n')).toBe('123456');
  });

  it('молчит, когда о коде не сказано ни слова', () => {
    expect(findCode('Заказ оформлен', 'Номер заказа 884213, доставка 25 июля')).toBeNull();
  });

  it('не принимает год из даты за код', () => {
    expect(findCode('Ваш код', 'Письмо от 28.07.2026, ждём ответа')).toBeNull();
  });

  it('не принимает время за код', () => {
    expect(findCode('Код входа', 'Вход выполнен в 08:48 по Москве')).toBeNull();
  });

  it('не выковыривает код из ссылки', () => {
    expect(
      findCode('Verification code', 'Open https://x.com/confirm/847213 to continue'),
    ).toBeNull();
  });

  it('не режет длинные числа на куски', () => {
    expect(findCode('Your code', 'Reference 12345678901234 for support')).toBeNull();
  });

  it('переживает точку в конце предложения', () => {
    expect(findCode(null, 'Your security code is 4821.')).toBe('4821');
  });

  it('не путает код с номером телефона в том же письме', () => {
    expect(findCode('Код подтверждения', 'Код: 730941. Поддержка: +7 900 123 45 67')).toBe(
      '730941',
    );
  });

  // Настоящее письмо ChatGPT: простой текст свёрстан таблицей, и между словом «code» и самим кодом стоит сотня пробелов.
  it('видит код через колонку пробелов', () => {
    const body = `Enter this temporary verification code to continue:${' '.repeat(97)}564835${' '.repeat(120)}If you were not trying to log in to ChatGPT, please reset your password.`;
    expect(findCode(null, body)).toBe('564835');
  });

  // Настоящее письмо Steam: код буквенно-цифровой, а под ним — ссылка восстановления.
  it('берёт буквенно-цифровой код Steam и не путает его со ссылкой', () => {
    const body = [
      'Hello alfierogersscott1995,',
      '',
      'Here is the code you need to change your Steam login credentials:',
      '',
      'Your account verification code is: KBKP3',
      '',
      'If you are not trying to change your Steam login credentials from a computer',
      'located in Hamburg, Germany, please ignore this email.',
      '',
      'View this message on the web:',
      'https://store.steampowered.com/email/AccountRecoveryCode?sparams=eJxtjk-LAjEMxb9Lz6IzivjnJKIgeFnw6iV2YmegbUqargzLfndTmcMe9pb3y3vJ-zEeSrQ9sowJzd40ZmYYwQednacHeAWJqStWIoRquQlCUJpLSsSCAQaveJKHXNeJXsjYzS39ceZBar4XSXl_X9wXPfo0_8c_Hc0YpYjVSLvZrFfbtmmWn3qWvpFHS109dz1ev1aKhVSAfw7I5JBztiTS7nbrWkBAcKp_gfAo7JRaKlF4nPjprMiTc9gNsf40v2-mJ2En&check=379184400f8db72fc7c33d484a69c056a452e4b02f16fc5a7d32d8bc2798074e',
    ].join('\n');
    expect(findCode(null, body)).toBe('KBKP3');
  });

  it('не принимает слово капслоком за код', () => {
    expect(findCode(null, 'SECURITY CODE: please check the app')).toBeNull();
    expect(findCode('Verification code', 'Cheers, The STEAM Team')).toBeNull();
    // Ровно пять букв, как у кода Steam, — и всё же слово: в алфавите кода нет гласных.
    expect(findCode('Verification code', 'STEAM GUARD')).toBeNull();
  });

  // Второе письмо Steam — вход с нового устройства.
  it('дотягивается до подсказки через вставленную строку', () => {
    const body =
      'qisxwsgp5,It looks like you are trying to log in from a new device. ' +
      'Here is the Steam Guard code you need to access your account:' +
      'Request made from Sweden H6TM5 &nbsp;If this wasn&apos;t youThis email was sent ' +
      'because someone attempted to log in to your Steam account. ' +
      'Cheers,The Steam Team © Valve Corporation PO Box 1688 Bellevue, WA 98009';
    expect(findCode(null, body)).toBe('H6TM5');
  });

  // То же письмо, но код без единой цифры: алфавит Steam такой допускает.
  it('видит код Steam из одних букв', () => {
    const body =
      'qisxwsgp5,It looks like you are trying to log in from a new device. ' +
      'Here is the Steam Guard code you need to access your account:' +
      'Request made from Sweden XXYMC &nbsp;If this wasn&apos;t youThis email was sent ' +
      'because someone attempted to log in to your Steam account. ' +
      'Cheers,The Steam Team © Valve Corporation PO Box 1688 Bellevue, WA 98009';
    expect(findCode(null, body)).toBe('XXYMC');
  });

  it('берёт кандидата, стоящего к слову о коде ближе прочих', () => {
    expect(findCode(null, 'Order 884213 shipped. Your login code is 730941')).toBe('730941');
  });
});

describe('tidyPlainText', () => {
  it('схлопывает колонки пробелов, оставляя строки', () => {
    expect(tidyPlainText('Код:          564835\n\n\n\nВаш ChatGPT   ')).toBe(
      'Код: 564835\n\nВаш ChatGPT',
    );
  });
});

describe('letterFacts', () => {
  it('сжимает тело в одну строку', () => {
    const f = letterFacts(letter(), '  много\n\n  пробелов   ');
    expect(f.preview).toBe('много пробелов');
  });

  it('обрезает предпросмотр', () => {
    const f = letterFacts(letter(), 'x'.repeat(500));
    expect(f.preview).toHaveLength(160);
  });
});

describe('filterLetters', () => {
  const withCode = letterFacts(letter({ id: 'a', subject: 'Код входа' }), 'Ваш код 445566');
  const plain = letterFacts(
    letter({ id: 'b', subject: 'Дайджест недели', from: 'news@openai.com' }),
    'Новости продукта',
  );

  it('считает письма с кодами', () => {
    expect(countCodes([withCode, plain])).toBe(1);
  });

  it('оставляет только письма с кодами', () => {
    expect(filterLetters([withCode, plain], '', true).map((f) => f.letter.id)).toEqual(['a']);
  });

  it('ищет по теме, отправителю и телу', () => {
    expect(matchesQuery(plain, 'дайджест')).toBe(true);
    expect(matchesQuery(plain, 'OPENAI')).toBe(true);
    expect(matchesQuery(plain, 'продукта')).toBe(true);
    expect(matchesQuery(plain, 'steam')).toBe(false);
  });

  it('пустой запрос пропускает всё', () => {
    expect(filterLetters([withCode, plain], '   ', false)).toHaveLength(2);
  });

  it('складывает поиск и фильтр по кодам', () => {
    expect(filterLetters([withCode, plain], 'дайджест', true)).toHaveLength(0);
  });
});

describe('dateBucket', () => {
  const now = new Date(2026, 7, 12, 15, 0, 0).getTime();
  const at = (y: number, m: number, d: number) => new Date(y, m, d, 9, 0, 0).getTime() / 1000;

  it('у сегодняшнего письма важно время', () => {
    expect(dateBucket(at(2026, 7, 12), now)).toBe('time');
  });

  it('у письма этого года — день', () => {
    expect(dateBucket(at(2026, 6, 28), now)).toBe('day');
  });

  it('у прошлогоднего — полная дата', () => {
    expect(dateBucket(at(2025, 11, 31), now)).toBe('date');
  });
});

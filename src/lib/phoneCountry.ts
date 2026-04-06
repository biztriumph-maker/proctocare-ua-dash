export interface PhoneCountry {
  iso2: string;
  nameUk: string;
  flag: string;
  dialCode: string;
  minNationalLength: number;
  maxNationalLength: number;
  isManual?: boolean;
}

export const PHONE_COUNTRIES: PhoneCountry[] = [
  // Europe
  { iso2: "AL", nameUk: "Албанія", flag: "🇦🇱", dialCode: "355", minNationalLength: 8, maxNationalLength: 9 },
  { iso2: "AD", nameUk: "Андорра", flag: "🇦🇩", dialCode: "376", minNationalLength: 6, maxNationalLength: 6 },
  { iso2: "AT", nameUk: "Австрія", flag: "🇦🇹", dialCode: "43", minNationalLength: 4, maxNationalLength: 13 },
  { iso2: "BE", nameUk: "Бельгія", flag: "🇧🇪", dialCode: "32", minNationalLength: 8, maxNationalLength: 9 },
  { iso2: "BA", nameUk: "Боснія і Герцеговина", flag: "🇧🇦", dialCode: "387", minNationalLength: 8, maxNationalLength: 8 },
  { iso2: "BG", nameUk: "Болгарія", flag: "🇧🇬", dialCode: "359", minNationalLength: 8, maxNationalLength: 9 },
  { iso2: "HR", nameUk: "Хорватія", flag: "🇭🇷", dialCode: "385", minNationalLength: 8, maxNationalLength: 9 },
  { iso2: "CY", nameUk: "Кіпр", flag: "🇨🇾", dialCode: "357", minNationalLength: 8, maxNationalLength: 8 },
  { iso2: "CZ", nameUk: "Чехія", flag: "🇨🇿", dialCode: "420", minNationalLength: 9, maxNationalLength: 9 },
  { iso2: "DK", nameUk: "Данія", flag: "🇩🇰", dialCode: "45", minNationalLength: 8, maxNationalLength: 8 },
  { iso2: "EE", nameUk: "Естонія", flag: "🇪🇪", dialCode: "372", minNationalLength: 7, maxNationalLength: 8 },
  { iso2: "FI", nameUk: "Фінляндія", flag: "🇫🇮", dialCode: "358", minNationalLength: 5, maxNationalLength: 12 },
  { iso2: "FR", nameUk: "Франція", flag: "🇫🇷", dialCode: "33", minNationalLength: 9, maxNationalLength: 9 },
  { iso2: "DE", nameUk: "Німеччина", flag: "🇩🇪", dialCode: "49", minNationalLength: 6, maxNationalLength: 13 },
  { iso2: "GR", nameUk: "Греція", flag: "🇬🇷", dialCode: "30", minNationalLength: 10, maxNationalLength: 10 },
  { iso2: "HU", nameUk: "Угорщина", flag: "🇭🇺", dialCode: "36", minNationalLength: 8, maxNationalLength: 9 },
  { iso2: "IS", nameUk: "Ісландія", flag: "🇮🇸", dialCode: "354", minNationalLength: 7, maxNationalLength: 7 },
  { iso2: "IE", nameUk: "Ірландія", flag: "🇮🇪", dialCode: "353", minNationalLength: 7, maxNationalLength: 9 },
  { iso2: "IT", nameUk: "Італія", flag: "🇮🇹", dialCode: "39", minNationalLength: 8, maxNationalLength: 10 },
  { iso2: "XK", nameUk: "Косово", flag: "🇽🇰", dialCode: "383", minNationalLength: 8, maxNationalLength: 8 },
  { iso2: "LV", nameUk: "Латвія", flag: "🇱🇻", dialCode: "371", minNationalLength: 8, maxNationalLength: 8 },
  { iso2: "LI", nameUk: "Ліхтенштейн", flag: "🇱🇮", dialCode: "423", minNationalLength: 7, maxNationalLength: 7 },
  { iso2: "LT", nameUk: "Литва", flag: "🇱🇹", dialCode: "370", minNationalLength: 8, maxNationalLength: 8 },
  { iso2: "LU", nameUk: "Люксембург", flag: "🇱🇺", dialCode: "352", minNationalLength: 8, maxNationalLength: 11 },
  { iso2: "MT", nameUk: "Мальта", flag: "🇲🇹", dialCode: "356", minNationalLength: 8, maxNationalLength: 8 },
  { iso2: "MD", nameUk: "Молдова", flag: "🇲🇩", dialCode: "373", minNationalLength: 8, maxNationalLength: 8 },
  { iso2: "MC", nameUk: "Монако", flag: "🇲🇨", dialCode: "377", minNationalLength: 8, maxNationalLength: 9 },
  { iso2: "ME", nameUk: "Чорногорія", flag: "🇲🇪", dialCode: "382", minNationalLength: 8, maxNationalLength: 8 },
  { iso2: "NL", nameUk: "Нідерланди", flag: "🇳🇱", dialCode: "31", minNationalLength: 9, maxNationalLength: 9 },
  { iso2: "MK", nameUk: "Північна Македонія", flag: "🇲🇰", dialCode: "389", minNationalLength: 8, maxNationalLength: 8 },
  { iso2: "NO", nameUk: "Норвегія", flag: "🇳🇴", dialCode: "47", minNationalLength: 8, maxNationalLength: 8 },
  { iso2: "PL", nameUk: "Польща", flag: "🇵🇱", dialCode: "48", minNationalLength: 9, maxNationalLength: 9 },
  { iso2: "PT", nameUk: "Португалія", flag: "🇵🇹", dialCode: "351", minNationalLength: 9, maxNationalLength: 9 },
  { iso2: "RO", nameUk: "Румунія", flag: "🇷🇴", dialCode: "40", minNationalLength: 9, maxNationalLength: 9 },
  { iso2: "SM", nameUk: "Сан-Марино", flag: "🇸🇲", dialCode: "378", minNationalLength: 6, maxNationalLength: 10 },
  { iso2: "RS", nameUk: "Сербія", flag: "🇷🇸", dialCode: "381", minNationalLength: 8, maxNationalLength: 9 },
  { iso2: "SK", nameUk: "Словаччина", flag: "🇸🇰", dialCode: "421", minNationalLength: 9, maxNationalLength: 9 },
  { iso2: "SI", nameUk: "Словенія", flag: "🇸🇮", dialCode: "386", minNationalLength: 8, maxNationalLength: 8 },
  { iso2: "ES", nameUk: "Іспанія", flag: "🇪🇸", dialCode: "34", minNationalLength: 9, maxNationalLength: 9 },
  { iso2: "SE", nameUk: "Швеція", flag: "🇸🇪", dialCode: "46", minNationalLength: 7, maxNationalLength: 10 },
  { iso2: "CH", nameUk: "Швейцарія", flag: "🇨🇭", dialCode: "41", minNationalLength: 9, maxNationalLength: 9 },
  { iso2: "TR", nameUk: "Туреччина", flag: "🇹🇷", dialCode: "90", minNationalLength: 10, maxNationalLength: 10 },
  { iso2: "UA", nameUk: "Україна", flag: "🇺🇦", dialCode: "380", minNationalLength: 9, maxNationalLength: 9 },
  { iso2: "GB", nameUk: "Велика Британія", flag: "🇬🇧", dialCode: "44", minNationalLength: 10, maxNationalLength: 10 },
  { iso2: "VA", nameUk: "Ватикан", flag: "🇻🇦", dialCode: "379", minNationalLength: 6, maxNationalLength: 10 },

  // Popular global countries
  { iso2: "US", nameUk: "США", flag: "🇺🇸", dialCode: "1", minNationalLength: 10, maxNationalLength: 10 },
  { iso2: "CA", nameUk: "Канада", flag: "🇨🇦", dialCode: "1", minNationalLength: 10, maxNationalLength: 10 },
  { iso2: "IL", nameUk: "Ізраїль", flag: "🇮🇱", dialCode: "972", minNationalLength: 8, maxNationalLength: 9 },
  { iso2: "AE", nameUk: "ОАЕ", flag: "🇦🇪", dialCode: "971", minNationalLength: 8, maxNationalLength: 9 },
  { iso2: "AU", nameUk: "Австралія", flag: "🇦🇺", dialCode: "61", minNationalLength: 9, maxNationalLength: 9 },
  { iso2: "NZ", nameUk: "Нова Зеландія", flag: "🇳🇿", dialCode: "64", minNationalLength: 8, maxNationalLength: 10 },
  { iso2: "JP", nameUk: "Японія", flag: "🇯🇵", dialCode: "81", minNationalLength: 9, maxNationalLength: 10 },
  { iso2: "KR", nameUk: "Південна Корея", flag: "🇰🇷", dialCode: "82", minNationalLength: 8, maxNationalLength: 10 },
  { iso2: "CN", nameUk: "Китай", flag: "🇨🇳", dialCode: "86", minNationalLength: 11, maxNationalLength: 11 },
  { iso2: "IN", nameUk: "Індія", flag: "🇮🇳", dialCode: "91", minNationalLength: 10, maxNationalLength: 10 },
  { iso2: "BR", nameUk: "Бразилія", flag: "🇧🇷", dialCode: "55", minNationalLength: 10, maxNationalLength: 11 },
  { iso2: "MX", nameUk: "Мексика", flag: "🇲🇽", dialCode: "52", minNationalLength: 10, maxNationalLength: 10 },
  { iso2: "ZA", nameUk: "ПАР", flag: "🇿🇦", dialCode: "27", minNationalLength: 9, maxNationalLength: 9 },
  { iso2: "EG", nameUk: "Єгипет", flag: "🇪🇬", dialCode: "20", minNationalLength: 10, maxNationalLength: 10 },
  { iso2: "SA", nameUk: "Саудівська Аравія", flag: "🇸🇦", dialCode: "966", minNationalLength: 9, maxNationalLength: 9 },
  { iso2: "TH", nameUk: "Таїланд", flag: "🇹🇭", dialCode: "66", minNationalLength: 9, maxNationalLength: 9 },
  { iso2: "SG", nameUk: "Сінгапур", flag: "🇸🇬", dialCode: "65", minNationalLength: 8, maxNationalLength: 8 },
  { iso2: "MY", nameUk: "Малайзія", flag: "🇲🇾", dialCode: "60", minNationalLength: 9, maxNationalLength: 10 },
  { iso2: "ID", nameUk: "Індонезія", flag: "🇮🇩", dialCode: "62", minNationalLength: 9, maxNationalLength: 11 },
  { iso2: "AR", nameUk: "Аргентина", flag: "🇦🇷", dialCode: "54", minNationalLength: 10, maxNationalLength: 10 },
  { iso2: "CL", nameUk: "Чилі", flag: "🇨🇱", dialCode: "56", minNationalLength: 9, maxNationalLength: 9 },
  { iso2: "CO", nameUk: "Колумбія", flag: "🇨🇴", dialCode: "57", minNationalLength: 10, maxNationalLength: 10 },
  { iso2: "NG", nameUk: "Нігерія", flag: "🇳🇬", dialCode: "234", minNationalLength: 10, maxNationalLength: 10 },
  { iso2: "KZ", nameUk: "Казахстан", flag: "🇰🇿", dialCode: "7", minNationalLength: 10, maxNationalLength: 10 },
  { iso2: "UZ", nameUk: "Узбекистан", flag: "🇺🇿", dialCode: "998", minNationalLength: 9, maxNationalLength: 9 },
  { iso2: "GE", nameUk: "Грузія", flag: "🇬🇪", dialCode: "995", minNationalLength: 9, maxNationalLength: 9 },
  { iso2: "AM", nameUk: "Вірменія", flag: "🇦🇲", dialCode: "374", minNationalLength: 8, maxNationalLength: 8 },
  { iso2: "AZ", nameUk: "Азербайджан", flag: "🇦🇿", dialCode: "994", minNationalLength: 9, maxNationalLength: 9 },
];

export const DEFAULT_PHONE_COUNTRY = PHONE_COUNTRIES.find((c) => c.iso2 === "UA") ?? PHONE_COUNTRIES[0];

function onlyDigits(value: string): string {
  return value.replace(/\D/g, "");
}

function createManualCountry(codeDigits: string): PhoneCountry {
  return {
    iso2: "ZZ",
    nameUk: "Інший код",
    flag: "🌐",
    dialCode: codeDigits,
    minNationalLength: 4,
    maxNationalLength: 14,
    isManual: true,
  };
}

function findCountryByDialDigits(rawDigits: string): PhoneCountry {
  const sorted = [...PHONE_COUNTRIES].sort((a, b) => b.dialCode.length - a.dialCode.length);
  return sorted.find((country) => rawDigits.startsWith(country.dialCode)) || createManualCountry(rawDigits.slice(0, Math.min(3, rawDigits.length || 1)) || "1");
}

export function splitPhoneValue(value: string): { country: PhoneCountry; nationalDigits: string } {
  const trimmed = value.trim();
  if (!trimmed) return { country: DEFAULT_PHONE_COUNTRY, nationalDigits: "" };

  const digits = onlyDigits(trimmed);
  if (!digits) return { country: DEFAULT_PHONE_COUNTRY, nationalDigits: "" };

  if (trimmed.startsWith("+")) {
    const country = findCountryByDialDigits(digits);
    return { country, nationalDigits: digits.slice(country.dialCode.length) };
  }

  // Backward compatibility: local UA numbers like 067... are treated as Ukraine.
  if (digits.startsWith("0")) {
    return { country: DEFAULT_PHONE_COUNTRY, nationalDigits: digits.slice(1) };
  }

  const country = findCountryByDialDigits(digits);
  if (digits.startsWith(country.dialCode)) {
    return { country, nationalDigits: digits.slice(country.dialCode.length) };
  }

  return { country: DEFAULT_PHONE_COUNTRY, nationalDigits: digits };
}

export function buildPhoneValue(country: PhoneCountry, nationalDigits: string): string {
  const localDigits = onlyDigits(nationalDigits);
  return `+${country.dialCode}${localDigits}`;
}

export function normalizePhoneValue(value: string): string {
  const { country, nationalDigits } = splitPhoneValue(value);
  return buildPhoneValue(country, nationalDigits);
}

export function isPhoneValueValid(value: string): boolean {
  const { country, nationalDigits } = splitPhoneValue(value);
  return nationalDigits.length >= country.minNationalLength && nationalDigits.length <= country.maxNationalLength;
}

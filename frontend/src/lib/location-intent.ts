const LOCATION_PHRASES = [
  'gan day', // gần đây
  'gan toi', // gần tôi
  'gan minh', // gần mình
  'gan nha', // gần nhà
  'gan cho nay', // gần chỗ này
  'gan cho toi', // gần chỗ tôi
  'gan vi tri cua toi', // gần vị trí của tôi
  'gan vi tri hien tai', // gần vị trí hiện tại
  'quanh day', // quanh đây
  'quanh toi', // quanh tôi
  'quanh khu nay', // quanh khu này
  'quanh cho nay', // quanh chỗ này
  'xung quanh', // xung quanh
  'o day', // ở đây
  'ngay day', // ngay đây
  'ngay gan day', // ngay gần đây
  'canh day', // cạnh đây
  'canh nha', // cạnh nhà
  'canh cho toi', // cạnh chỗ tôi
  'tai vi tri cua toi', // tại vị trí của tôi
  'tai cho toi', // tại chỗ tôi
];

const NON_LOCATION_EXCLUSIONS = [
  /gần\s+đầy/, // "gần đầy đủ" (near-complete) collides with "gần đây"
];

function stripDiacritics(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/\s+/g, ' ')
    .trim();
}

export function hasLocationIntent(query: string): boolean {
  if (!query) return false;
  const normalized = stripDiacritics(query);
  if (!LOCATION_PHRASES.some((phrase) => normalized.includes(phrase))) return false;
  const saysToi = /gần\s+tôi/.test(query);
  if (!saysToi && /gần\s+tối/.test(query)) return false;
  if (NON_LOCATION_EXCLUSIONS.some((pattern) => pattern.test(query))) return false;
  return true;
}

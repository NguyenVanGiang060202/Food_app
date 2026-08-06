type TasteOption = { value: string; label: string };
type TasteGroup = { key: string; title: string; options: TasteOption[] };

export const filterGroups: TasteGroup[] = [
  {
    key: 'feel',
    title: 'Cảm giác',
    options: [
      { value: 'nóng', label: 'Nóng' },
      { value: 'cay', label: 'Cay' },
      { value: 'nhẹ bụng', label: 'Nhẹ bụng' },
      { value: 'mát', label: 'Mát' },
      { value: 'ngọt', label: 'Ngọt' },
    ],
  },
  {
    key: 'fullness',
    title: 'Mức no',
    options: [
      { value: 'no lâu', label: 'No lâu' },
      { value: 'ăn nhẹ', label: 'Ăn nhẹ' },
      { value: 'rẻ', label: 'Tiết kiệm' },
    ],
  },
  {
    key: 'style',
    title: 'Cách ăn',
    options: [
      { value: 'ít dầu', label: 'Ít dầu' },
      { value: 'nhiều rau', label: 'Nhiều rau' },
      { value: 'chay', label: 'Chay' },
      { value: 'ăn vặt', label: 'Ăn vặt' },
    ],
  },
  {
    key: 'time',
    title: 'Dịp ăn',
    options: [
      { value: 'bữa sáng', label: 'Bữa sáng' },
      { value: 'bữa trưa', label: 'Bữa trưa' },
      { value: 'buổi tối', label: 'Buổi tối' },
      { value: 'ăn khuya', label: 'Ăn khuya' },
    ],
  },
  { key: 'distance', title: 'Khoảng cách', options: [{ value: 'gần đây', label: 'Gần đây' }] },
];
export const distanceOptions = [
  { value: 2, label: 'Trong 2km' },
  { value: 5, label: 'Trong 5km' },
];
export const attrLabel = (value: string) =>
  filterGroups.flatMap((group) => group.options).find((option) => option.value === value)?.label ??
  value;

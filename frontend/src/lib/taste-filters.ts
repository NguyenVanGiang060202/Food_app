type TasteOption = { value: string; label: string };
type TasteGroup = { key: string; title: string; options: TasteOption[] };

export const filterGroups: TasteGroup[] = [
  {
    key: 'feel',
    title: 'Cảm giác',
    options: [
      { value: 'nóng', label: 'Nóng' },
      { value: 'cay', label: 'Cay' },
      { value: 'ngọt', label: 'Ngọt' },
      { value: 'mặn', label: 'Mặn' },
      { value: 'chua', label: 'Chua' },
      { value: 'béo', label: 'Béo' },
      { value: 'giòn', label: 'Giòn' },
      { value: 'mát', label: 'Mát' },
      { value: 'nhẹ bụng', label: 'Nhẹ bụng' },
      { value: 'đậm đà', label: 'Đậm đà' },
      { value: 'thanh đạm', label: 'Thanh đạm' },
      { value: 'tươi', label: 'Tươi' },
    ],
  },
  {
    key: 'fill',
    title: 'Mức no',
    options: [
      { value: 'no lâu', label: 'No lâu' },
      { value: 'no xổi', label: 'No xổi' },
      { value: 'ăn nhẹ', label: 'Ăn nhẹ' },
      { value: 'ăn vặt', label: 'Ăn vặt' },
      { value: 'rẻ', label: 'Tiết kiệm' },
      { value: 'đầy bữa', label: 'Đầy bữa' },
    ],
  },
  {
    key: 'dish',
    title: 'Món chính',
    options: [
      { value: 'cơm', label: 'Cơm' },
      { value: 'cơm tấm', label: 'Cơm tấm' },
      { value: 'phở', label: 'Phở' },
      { value: 'bún', label: 'Bún' },
      { value: 'bún bò', label: 'Bún bò' },
      { value: 'bún riêu', label: 'Bún riêu' },
      { value: 'mì', label: 'Mì' },
      { value: 'hủ tiếu', label: 'Hủ tiếu' },
      { value: 'bánh canh', label: 'Bánh canh' },
      { value: 'miến', label: 'Miến' },
      { value: 'cháo', label: 'Cháo' },
      { value: 'bánh mì', label: 'Bánh mì' },
      { value: 'bánh cuốn', label: 'Bánh cuốn' },
      { value: 'bánh xèo', label: 'Bánh xèo' },
      { value: 'xôi', label: 'Xôi' },
      { value: 'lẩu', label: 'Lẩu' },
      { value: 'gỏi', label: 'Gỏi' },
      { value: 'sushi', label: 'Sushi' },
      { value: 'pizza', label: 'Pizza' },
      { value: 'bbq', label: 'BBQ' },
      { value: 'bánh tráng trộn', label: 'Bánh tráng trộn' },
    ],
  },
  {
    key: 'style',
    title: 'Cách ăn',
    options: [
      { value: 'chay', label: 'Chay' },
      { value: 'hải sản', label: 'Hải sản' },
      { value: 'ít dầu', label: 'Ít dầu' },
      { value: 'nhiều rau', label: 'Nhiều rau' },
      { value: 'mang về', label: 'Mang về' },
      { value: 'buffet', label: 'Buffet' },
      { value: 'hấp', label: 'Hấp' },
      { value: 'chiên', label: 'Chiên' },
      { value: 'nướng', label: 'Nướng' },
      { value: 'khuya', label: 'Ăn khuya' },
      { value: 'đường phố', label: 'Đường phố' },
    ],
  },
  {
    key: 'time',
    title: 'Dịp ăn',
    options: [
      { value: 'bữa sáng', label: 'Bữa sáng' },
      { value: 'bữa trưa', label: 'Bữa trưa' },
      { value: 'buổi tối', label: 'Buổi tối' },
      { value: 'cuối tuần', label: 'Cuối tuần' },
      { value: 'hẹn hò', label: 'Hẹn hò' },
      { value: 'họp bạn', label: 'Họp bạn' },
      { value: 'một mình', label: 'Một mình' },
    ],
  },
  {
    key: 'distance',
    title: 'Khoảng cách',
    options: [{ value: 'gần đây', label: 'Gần đây' }],
  },
];

// Price tiers shown in the AskPage filter panel. They map to the backend's
// numeric `priceLevel` (1 = cheapest … 4 = priciest).
export const priceLevelOptions: TasteOption[] = [
  { value: '1', label: 'Vừa ví' },
  { value: '2', label: 'Hợp lý' },
  { value: '3', label: 'Hơi cao' },
  { value: '4', label: 'Sang miệng' },
];

export const ratingOptions: TasteOption[] = [
  { value: '3.5', label: '3.5 sao' },
  { value: '4', label: '4 sao' },
  { value: '4.5', label: '4.5 sao' },
];

export const distanceOptions = [
  { value: 2, label: 'Trong 2km' },
  { value: 5, label: 'Trong 5km' },
];

export const attrLabel = (value: string) =>
  filterGroups.flatMap((group) => group.options).find((option) => option.value === value)?.label ??
  value;

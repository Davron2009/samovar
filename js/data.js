export const CATEGORIES = [
  { id: 'all', name: 'Barchasi', icon: '🍽️' },
  { id: 'Asosiy Taomlar', name: 'Asosiy Taomlar', icon: '🥘' },
  { id: 'Shashlik', name: 'Shashlik & Kabob', icon: '🍢' },
  { id: 'Salat', name: 'Salat & Gazaklar', icon: '🥗' },
  { id: 'Ichimliklar', name: 'Samovar & Ichimliklar', icon: '🫖' },
  { id: 'Shirinliklar', name: 'Non & Shirinliklar', icon: '🥐' }
];

export const AVAILABLE_TABLES = Array.from({ length: 9 }, (_, index) => `Stol ${index + 1}`);

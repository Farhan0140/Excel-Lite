// Fill colours a cell can have (cell.f = 1..8). The screen uses CSS variables (--f1..--f8, light and dark),
// the PDF always prints the light versions.
export const FILLS = [
  { n: 1, name: 'Yellow', light: '#FBEFC0', dark: '#4A4220' },
  { n: 2, name: 'Green', light: '#D2EBD4', dark: '#22452C' },
  { n: 3, name: 'Blue', light: '#D0E3F5', dark: '#213A50' },
  { n: 4, name: 'Pink', light: '#F5D5DB', dark: '#502B34' },
  { n: 5, name: 'Grey', light: '#E3E5E1', dark: '#333B3B' },
  { n: 6, name: 'Orange', light: '#F8DAC0', dark: '#56361E' },
  { n: 7, name: 'Purple', light: '#E1D8F2', dark: '#40305A' },
  { n: 8, name: 'Red', light: '#F1B9B1', dark: '#6A2E2A' },
];
export const PDF_FILL = ['', ...FILLS.map((f) => f.light)];

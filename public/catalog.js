export const flavors = Object.freeze({
  smooth: { label: 'كاكاو وبندق', price: 59 },
  bright: { label: 'توت وياسمين', price: 65 },
  balanced: { label: 'تمر وكراميل', price: 62 },
});

export const grinds = Object.freeze({
  whole: 'حبوب كاملة',
  filter: 'طحن للترشيح',
  espresso: 'طحن للإسبريسو',
});

export const weights = Object.freeze({ '250': '٢٥٠ غ', '500': '٥٠٠ غ' });
export const cadences = Object.freeze({ '14': 'كل أسبوعين', '28': 'كل ٤ أسابيع' });

export function quote({ flavor, weight }) {
  return flavors[flavor].price + (weight === '500' ? 44 : 0);
}

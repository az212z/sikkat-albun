import { copyFile, cp, mkdir, readFile, writeFile } from 'node:fs/promises';

const target = new URL('../docs/', import.meta.url);
await mkdir(target, { recursive: true });
await cp(new URL('../public/', import.meta.url), target, { recursive: true });
await copyFile(new URL('./save-draft.js', import.meta.url), new URL('save-draft.js', target));
const index = new URL('index.html', target);
const html = await readFile(index, 'utf8');
await writeFile(index, html
  .replace('  <meta name="robots"', `  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; base-uri 'none'; form-action 'none'">\n  <meta name="robots"`)
  .replace('حفظ مسودته محليًا.', 'حفظ مسودته في المتصفح.')
  .replace('نموذج تجريبي · الحفظ دون دفع أو شحن', 'نموذج تجريبي · المسودة تُحفظ في متصفحك')
  .replace('حفظ المسودة في هذا النموذج.', 'حفظ المسودة في متصفحك.')
  .replace('يظهر مرجع المسودة بعد الحفظ. احتفظ به قبل مغادرة الصفحة، فالنموذج لا يستعيد المسودة عند العودة. يحتفظ النموذج بالاختيارات سبعة أيام تقريبًا، دون اسم أو رقم جوال.', 'تُحفظ آخر مسودة في هذا المتصفح، وتظهر اختياراتها عند العودة خلال سبعة أيام إذا بقيت بيانات الموقع محفوظة. الحفظ لا يطلب اسمًا أو رقم جوال ولا يفعّل دفعًا أو شحنًا.'));
await writeFile(new URL('.nojekyll', target), '');

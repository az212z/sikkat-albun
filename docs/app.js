import { cadences, flavors, grinds, quote, weights } from './catalog.js';
import { loadDraft, saveDraft } from './save-draft.js';

const form = document.querySelector('#configurator');
const status = document.querySelector('#status');
const submit = form.querySelector('button');
const fields = [...form.querySelectorAll('select')];
const formatter = new Intl.NumberFormat('ar-SA');
let requestKey = crypto.randomUUID();
let busy = false;

function selection() {
  const data = new FormData(form);
  return Object.fromEntries(data);
}

function refresh({ reset = true } = {}) {
  const { flavor, grind, weight, cadence } = selection();
  document.querySelector('#selection').textContent = [
    flavors[flavor].label, grinds[grind], weights[weight], cadences[cadence],
  ].join(' · ');
  document.querySelector('#price').textContent = `${formatter.format(quote({ flavor, weight }))} ر.س`;
  if (reset) {
    requestKey = crypto.randomUUID();
    status.replaceChildren();
  }
}

for (const link of document.querySelectorAll('[data-flavor]')) {
  link.addEventListener('click', event => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (busy) return;
    form.elements.flavor.value = link.dataset.flavor;
    refresh();
    if (location.hash !== '#plan') history.pushState(null, '', '#plan');
    document.querySelector('#plan').scrollIntoView();
    document.querySelector('#plan-title').focus({ preventScroll: true });
  });
}

form.addEventListener('change', () => refresh());
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (busy) return;
  const payload = { ...selection(), requestKey };
  busy = true;
  submit.setAttribute('aria-disabled', 'true');
  fields.forEach(field => { field.disabled = true; });
  status.textContent = 'جارٍ حفظ المسودة…';

  try {
    showSaved(await saveDraft(payload));
  } catch (error) {
    status.textContent = error.status === 429
      ? 'انتظر دقيقة ثم جرّب الحفظ من جديد.'
      : 'تعذّر حفظ المسودة. اختياراتك موجودة، حاول مرة ثانية.';
  } finally {
    busy = false;
    fields.forEach(field => { field.disabled = false; });
    submit.removeAttribute('aria-disabled');
  }
});

function showSaved(saved) {
  const reference = document.createElement('bdi');
  reference.dir = 'ltr';
  reference.textContent = saved.reference;
  status.replaceChildren('تم الحفظ. مرجع المسودة ', reference);
}

const saved = loadDraft();
if (saved) {
  for (const field of fields) field.value = saved[field.name];
  requestKey = saved.requestKey;
  showSaved(saved);
}
refresh({ reset: false });
submit.disabled = false;

/* Expense request on a phone: one short card at a time with Back and Next. On a wider screen all
   four parts show at once in two columns, and this does nothing. */
(() => {
  const form = document.getElementById('exp-form');
  if (!form) return;
  const steps = [...form.querySelectorAll('.exp-step')];
  const back = document.getElementById('exp-back');
  const next = document.getElementById('exp-next');
  const name = document.getElementById('exp-stepname');
  const bars = [...document.querySelectorAll('#exp-progress span')];
  const phone = window.matchMedia('(max-width: 860px)');
  let at = 0;
  const show = (i) => {
    at = Math.max(0, Math.min(steps.length - 1, i));
    steps.forEach((s, k) => s.classList.toggle('is-on', k === at));
    bars.forEach((b, k) => b.classList.toggle('is-on', k <= at));
    name.textContent = `Step ${at + 1} of ${steps.length} · ${steps[at].dataset.title}`;
    back.hidden = at === 0;
    next.hidden = at === steps.length - 1;
    form.classList.toggle('is-last', at === steps.length - 1);
    if (phone.matches) form.scrollIntoView({ block: 'start' });
  };
  const ok = () => {
    if (at === 0) {
      const n = document.getElementById('exp-name'), e = document.getElementById('exp-email');
      if (!n.value.trim() || !e.value.trim()) { (n.value.trim() ? e : n).focus(); return false; }
    }
    if (at === 2 && !document.getElementById('exp-reason').value.trim()) { document.getElementById('exp-reason').focus(); return false; }
    return true;
  };
  back.addEventListener('click', () => show(at - 1));
  next.addEventListener('click', () => { if (ok()) show(at + 1); });
  form.classList.add('is-stepped');
  show(0);
})();

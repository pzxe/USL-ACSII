(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const set = (id, v) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event(id === 'charset' ? 'change' : 'input')); };
  set('charset', 'detailed');
  set('cols', 150);
  set('contrast', 20);
  await wait(500);
  return { status: document.getElementById('status').textContent, dims: document.getElementById('ascii-dims').textContent };
})()

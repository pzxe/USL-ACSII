(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const log = [];
  // switch to crimson + manga blocks, then export everything
  document.querySelector('#color-seg button[data-v="crimson"]').click();
  await wait(300);
  for (const id of ['ex-txt', 'ex-html', 'ex-png', 'ex-gif']) {
    const b = document.getElementById(id);
    log.push(id + ' disabled=' + b.disabled);
    if (!b.disabled) b.click();
    await wait(id === 'ex-gif' ? 6000 : 1500);
  }
  log.push('status=' + document.getElementById('status').textContent);
  return log;
})()

<script>
  import { onMount } from 'svelte'

  const MODES = ['system', 'light', 'dark']
  const STORED = 'spore-mode'

  let mode = $state('system')

  onMount(() => {
    mode = document.documentElement.dataset.theme ?? 'system'
  })

  function next() {
    mode = MODES[(MODES.indexOf(mode) + 1) % MODES.length]
    if (mode === 'system') delete document.documentElement.dataset.theme
    else document.documentElement.dataset.theme = mode
    try {
      if (mode === 'system') window.localStorage.removeItem(STORED)
      else window.localStorage.setItem(STORED, mode)
    } catch (err) {
      console.warn('the colour scheme could not be remembered', err)
    }
  }
</script>

<button class="mode" type="button" aria-label="Colour scheme: {mode}" title="Colour scheme: {mode}" onclick={next}>
  <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor" stroke="none" /></svg>
</button>

<style>
  .mode {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    padding: 0;
    border: 0;
    border-radius: var(--radius-small);
    background: none;
    color: var(--text-muted);
  }
  .mode:hover {
    background: var(--hover);
    color: var(--text);
  }
  svg {
    width: 18px;
    height: 18px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.75;
  }
  @media (pointer: coarse) {
    .mode {
      width: 44px;
      height: 44px;
    }
  }
</style>

<script>
  let { value = $bindable(''), ...rest } = $props()

  let shown = $state(false)
</script>

<span class="wrap">
  <input class="input" type={shown ? 'text' : 'password'} bind:value {...rest} />
  <button class="eye" type="button" aria-label={shown ? 'Hide password' : 'Show password'} aria-pressed={shown} onclick={() => (shown = !shown)}>
    <svg class="glyph" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M2.5 12c2.4-4 5.6-6 9.5-6s7.1 2 9.5 6c-2.4 4-5.6 6-9.5 6s-7.1-2-9.5-6z" />
      <circle cx="12" cy="12" r="2.5" />
      {#if shown}
        <path d="M4 4l16 16" />
      {/if}
    </svg>
  </button>
</span>

<style>
  .wrap {
    position: relative;
    display: block;
  }
  .input {
    width: 100%;
    min-height: 32px;
    padding: 6px 36px 6px var(--s3);
    border: 1px solid var(--border);
    border-radius: var(--radius-small);
    background: var(--bg);
  }
  .input:focus-visible {
    outline-offset: -1px;
  }
  .eye {
    position: absolute;
    inset: 0 0 0 auto;
    width: 32px;
    display: grid;
    place-items: center;
    padding: 0;
    border: 0;
    border-radius: var(--radius-small);
    background: none;
    color: var(--text-muted);
  }
  .eye:hover {
    color: var(--text);
  }
  @media (pointer: coarse) {
    .input {
      min-height: 44px;
    }
    .eye {
      width: 44px;
    }
  }
</style>

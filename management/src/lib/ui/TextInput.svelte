<script>
  let { value = $bindable(''), ...rest } = $props()
</script>

<input class="input" type="text" bind:value {...rest} />

<style>
  .input {
    width: 100%;
    min-height: 32px;
    padding: 6px var(--s3);
    border: 1px solid var(--border);
    border-radius: var(--radius-small);
    background: var(--bg);
  }
  .input:focus-visible {
    outline-offset: -1px;
  }
  @media (pointer: coarse) {
    .input {
      min-height: 44px;
    }
  }
</style>

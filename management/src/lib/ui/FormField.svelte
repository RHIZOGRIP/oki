<script>
  let { label, error = '', helperText = '', children } = $props()

  const id = $props.id()
  const inputProps = $derived({
    id,
    'aria-invalid': error ? 'true' : undefined,
    'aria-describedby': error || helperText ? `${id}-message` : undefined
  })
</script>

<div class="field">
  <label for={id}>{label}</label>
  {@render children?.({ inputProps })}
  {#if error}
    <p class="message error" id="{id}-message" role="alert">{error}</p>
  {:else if helperText}
    <p class="message" id="{id}-message">{helperText}</p>
  {/if}
</div>

<style>
  .field {
    display: flex;
    flex-direction: column;
    gap: var(--s1);
    min-width: 0;
  }
  label {
    font-weight: 500;
  }
  .message {
    font-size: var(--size-ui);
    color: var(--text-muted);
  }
  .error {
    color: var(--danger);
  }
</style>

<script>
  let { checked = $bindable(false), label, ...rest } = $props()
</script>

<label class="check">
  <input type="checkbox" bind:checked {...rest} />
  <span>{label}</span>
</label>

<style>
  .check {
    display: flex;
    align-items: flex-start;
    gap: var(--s2);
    line-height: 1.5;
  }
  input {
    flex: none;
    width: 16px;
    height: 16px;
    margin: 3px 0 0;
    accent-color: var(--accent);
  }
</style>

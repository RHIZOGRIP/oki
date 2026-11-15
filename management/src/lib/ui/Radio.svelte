<script>
  import { getContext } from 'svelte'

  let { value, label, description } = $props()

  const group = getContext('radio-group')
</script>

<label class="radio">
  <input type="radio" name={group.name} {value} bind:group={group.value} />
  <span class="text">
    <span>{label}</span>
    {#if description}
      <span class="description">{description}</span>
    {/if}
  </span>
</label>

<style>
  .radio {
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
  .text {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .description {
    font-size: var(--size-ui);
    color: var(--text-muted);
  }
</style>

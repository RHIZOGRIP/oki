<script>
  let { title, folded = false, action, children } = $props()
</script>

{#if folded}
  <details class="section">
    <summary>{title}</summary>
    <div class="body">
      {@render children?.()}
    </div>
  </details>
{:else}
  <section class="section">
    <div class="head">
      <h2>{title}</h2>
      {@render action?.()}
    </div>
    <div class="body">
      {@render children?.()}
    </div>
  </section>
{/if}

<style>
  .section {
    padding: var(--s4);
    border-radius: var(--radius-large);
    background: var(--raised);
    box-shadow: var(--shadow-low);
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--s3);
    min-height: 28px;
  }
  h2,
  summary {
    font-size: var(--size-ui);
    font-weight: 500;
    color: var(--text-muted);
  }
  .head,
  details[open] summary {
    margin-bottom: var(--s3);
  }
  summary {
    cursor: pointer;
  }
  .body > :global(* + *) {
    margin-top: var(--s3);
  }
</style>

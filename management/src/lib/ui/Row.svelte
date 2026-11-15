<script>
  let { title, tags, detail, action } = $props()
</script>

<li class="row">
  <div class="what">
    <div class="first">
      <span class="title">{title}</span>
      {@render tags?.()}
    </div>
    <div class="detail">{@render detail?.()}</div>
  </div>
  {@render action?.()}
</li>

<style>
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--s4);
    padding: var(--s3) 0;
    border-bottom: 1px solid var(--hairline);
  }
  .row:last-child {
    border-bottom: 0;
    padding-bottom: 0;
  }
  .what {
    display: flex;
    flex-direction: column;
    gap: var(--s1);
    min-width: 0;
  }
  .first {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--s2) var(--s3);
  }
  .title {
    font-weight: 600;
  }
  .detail {
    font-size: var(--size-ui);
    color: var(--text-muted);
    overflow-wrap: anywhere;
  }
</style>

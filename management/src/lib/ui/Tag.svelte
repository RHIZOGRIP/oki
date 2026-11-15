<script>
  let { label, tone = 'neutral' } = $props()
</script>

<span class="tag" data-tone={tone}>{label}</span>

<style>
  .tag {
    display: inline-block;
    padding: 3px 6px;
    border-radius: var(--radius-small);
    box-shadow: inset 0 0 0 1px color-mix(in oklab, currentColor 35%, transparent);
    font: 500 12px/1 var(--font);
    white-space: nowrap;
    color: var(--text-muted);
  }
  .tag[data-tone='success'] {
    color: var(--ok);
  }
  .tag[data-tone='warning'] {
    color: var(--warn);
  }
  .tag[data-tone='danger'] {
    color: var(--danger);
  }
  .tag[data-tone='info'] {
    color: var(--accent);
  }
</style>

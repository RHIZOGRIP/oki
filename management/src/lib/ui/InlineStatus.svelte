<script>
  let { tone = 'info', role = 'status', children } = $props()

  const MARKS = {
    success: 'M5 12l5 5 9-10',
    danger: 'M12 8v5M12 16.5v.5M12 3l9.5 17h-19z',
    warning: 'M12 8v5M12 16.5v.5M12 3l9.5 17h-19z',
    info: 'M12 11v6M12 7.5v.5M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18z'
  }
</script>

<span class="status" data-tone={tone} {role} aria-live={role === 'alert' ? 'assertive' : 'polite'}>
  <svg class="glyph" viewBox="0 0 24 24" aria-hidden="true"><path d={MARKS[tone]} /></svg>
  <span>{@render children?.()}</span>
</span>

<style>
  .status {
    display: flex;
    align-items: flex-start;
    gap: var(--s2);
    font-size: var(--size-prose);
    line-height: 1.5;
    color: var(--text-muted);
  }
  .status .glyph {
    margin-top: 2.5px;
  }
  .status[data-tone='success'] {
    color: var(--ok);
  }
  .status[data-tone='warning'] {
    color: var(--warn);
  }
  .status[data-tone='danger'] {
    color: var(--danger);
  }
</style>
